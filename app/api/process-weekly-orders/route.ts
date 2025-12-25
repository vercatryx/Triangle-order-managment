import { NextRequest, NextResponse } from 'next/server';
import { getClients, getMenuItems, getVendors, getBoxTypes, getSettings } from '@/lib/actions';
import { ClientProfile, OrderConfiguration } from '@/lib/types';

/**
 * Helper function to check if a date is in the current week
 * Week starts on Sunday and ends on Saturday
 */
function isInCurrentWeek(dateString: string): boolean {
    if (!dateString) return false;
    
    const date = new Date(dateString);
    const today = new Date();
    
    // Get the start of the week (Sunday)
    const startOfWeek = new Date(today);
    const day = startOfWeek.getDay();
    startOfWeek.setDate(today.getDate() - day);
    startOfWeek.setHours(0, 0, 0, 0);
    
    // Get the end of the week (Saturday)
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    
    return date >= startOfWeek && date <= endOfWeek;
}

/**
 * Process a single order and return summary data
 */
function processOrder(
    client: ClientProfile,
    order: OrderConfiguration,
    menuItems: any[],
    vendors: any[],
    boxTypes: any[]
) {
    const orderSummary: any = {
        clientId: client.id,
        clientName: client.fullName,
        serviceType: order.serviceType,
        lastUpdated: order.lastUpdated,
        updatedBy: order.updatedBy,
        caseId: order.caseId || null,
        vendorDetails: [],
        totalValue: 0,
        totalItems: 0,
        deliveryDistribution: order.deliveryDistribution || {}
    };

    if (order.serviceType === 'Food' && order.vendorSelections) {
        // Process Food orders with multiple vendors
        for (const selection of order.vendorSelections) {
            if (!selection.vendorId || !selection.items) continue;

            const vendor = vendors.find(v => v.id === selection.vendorId);
            const vendorSummary: any = {
                vendorId: selection.vendorId,
                vendorName: vendor?.name || 'Unknown Vendor',
                items: [],
                totalValue: 0,
                totalQuantity: 0
            };

            for (const [itemId, quantity] of Object.entries(selection.items)) {
                if (quantity <= 0) continue;

                const item = menuItems.find(m => m.id === itemId);
                if (item) {
                    const itemValue = item.value * quantity;
                    vendorSummary.items.push({
                        itemId: item.id,
                        itemName: item.name,
                        quantity: quantity,
                        unitValue: item.value,
                        totalValue: itemValue
                    });
                    vendorSummary.totalValue += itemValue;
                    vendorSummary.totalQuantity += quantity;
                }
            }

            if (vendorSummary.items.length > 0) {
                orderSummary.vendorDetails.push(vendorSummary);
                orderSummary.totalValue += vendorSummary.totalValue;
                orderSummary.totalItems += vendorSummary.totalQuantity;
            }
        }
    } else if (order.serviceType === 'Boxes' && order.boxTypeId) {
        // Process Box orders
        const boxType = boxTypes.find(b => b.id === order.boxTypeId);
        const vendor = vendors.find(v => v.id === order.vendorId);
        
        orderSummary.vendorDetails.push({
            vendorId: order.vendorId || null,
            vendorName: vendor?.name || 'Unknown Vendor',
            boxTypeId: order.boxTypeId,
            boxTypeName: boxType?.name || 'Unknown Box Type',
            quantity: order.boxQuantity || 0
        });
        orderSummary.totalItems = order.boxQuantity || 0;
    }

    return orderSummary;
}

/**
 * API Route: Process all current orders of the week
 * 
 * POST /api/process-weekly-orders
 * 
 * Request Body (optional):
 * {
 *   "weekStart": "2025-01-05T00:00:00Z",  // Optional: Custom week start date
 *   "weekEnd": "2025-01-11T23:59:59Z"     // Optional: Custom week end date
 * }
 * 
 * If no body is provided, processes orders for the current week (Sunday-Saturday)
 * Returns a comprehensive summary of all orders updated in the specified week
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { weekStart, weekEnd } = body;

        // If custom week range provided, use it; otherwise use current week
        let startOfWeek: Date;
        let endOfWeek: Date;

        if (weekStart && weekEnd) {
            startOfWeek = new Date(weekStart);
            endOfWeek = new Date(weekEnd);
        } else {
            const today = new Date();
            startOfWeek = new Date(today);
            const day = startOfWeek.getDay();
            startOfWeek.setDate(today.getDate() - day);
            startOfWeek.setHours(0, 0, 0, 0);
            
            endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            endOfWeek.setHours(23, 59, 59, 999);
        }

        // Custom function to check if date is in specified week range
        const isInWeekRange = (dateString: string): boolean => {
            if (!dateString) return false;
            const date = new Date(dateString);
            return date >= startOfWeek && date <= endOfWeek;
        };

        // Fetch all required data
        const [clients, menuItems, vendors, boxTypes, settings] = await Promise.all([
            getClients(),
            getMenuItems(),
            getVendors(),
            getBoxTypes(),
            getSettings()
        ]);

        // Filter clients with active orders in the specified week
        const weekOrders = clients
            .filter(client => {
                if (!client.activeOrder || !client.activeOrder.lastUpdated) return false;
                return isInWeekRange(client.activeOrder.lastUpdated);
            })
            .map(client => ({
                client,
                order: client.activeOrder!
            }));

        // Process each order using the shared processOrder function
        const processedOrders = weekOrders.map(({ client, order }) =>
            processOrder(client, order, menuItems, vendors, boxTypes)
        );

        // Calculate aggregate statistics
        const stats = {
            totalOrders: processedOrders.length,
            totalClients: new Set(processedOrders.map(o => o.clientId)).size,
            totalValue: processedOrders.reduce((sum, o) => sum + o.totalValue, 0),
            totalItems: processedOrders.reduce((sum, o) => sum + o.totalItems, 0),
            byServiceType: {
                Food: processedOrders.filter(o => o.serviceType === 'Food').length,
                Boxes: processedOrders.filter(o => o.serviceType === 'Boxes').length,
                'Cooking supplies': processedOrders.filter(o => o.serviceType === 'Cooking supplies').length,
                'Care plan': processedOrders.filter(o => o.serviceType === 'Care plan').length
            },
            byVendor: {} as Record<string, number>
        };

        processedOrders.forEach(order => {
            order.vendorDetails.forEach((vendor: any) => {
                const vendorName = vendor.vendorName || 'Unknown';
                stats.byVendor[vendorName] = (stats.byVendor[vendorName] || 0) + 1;
            });
        });

        return NextResponse.json({
            success: true,
            weekRange: {
                start: startOfWeek.toISOString(),
                end: endOfWeek.toISOString(),
                startFormatted: startOfWeek.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                }),
                endFormatted: endOfWeek.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                })
            },
            settings: {
                weeklyCutoffDay: settings.weeklyCutoffDay,
                weeklyCutoffTime: settings.weeklyCutoffTime
            },
            statistics: stats,
            orders: processedOrders,
            processedAt: new Date().toISOString()
        }, { status: 200 });

    } catch (error: any) {
        console.error('Error processing weekly orders:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to process weekly orders',
            processedAt: new Date().toISOString()
        }, { status: 500 });
    }
}

