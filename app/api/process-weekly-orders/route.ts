import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getMenuItems, getVendors, getBoxTypes, getSettings, getClient } from '@/lib/actions';

/**
 * API Route: Process all current active orders from orders table
 * 
 * POST /api/process-weekly-orders
 * 
 * This endpoint:
 * 1. Fetches all active orders (status: 'pending' or 'confirmed') from the orders table
 * 2. If no orders exist, falls back to upcoming_orders table (status: 'scheduled' or 'confirmed')
 * 3. Processes each order with full details (vendor selections, items, box selections)
 * 4. Creates a billing record for each processed order
 * 
 * Returns a comprehensive summary of processed orders and created billing records
 */
export async function POST(request: NextRequest) {
    try {
        // Fetch all active orders from orders table
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('*')
            .in('status', ['pending', 'confirmed'])
            .order('created_at', { ascending: true });

        if (ordersError) {
            throw new Error(`Failed to fetch orders: ${ordersError.message}`);
        }

        // If no orders found, fetch from upcoming_orders table
        let ordersToProcess: any[] = [];
        let isFromUpcomingOrders = false;

        if (!orders || orders.length === 0) {
            // Fetch from upcoming_orders table
            const { data: upcomingOrders, error: upcomingError } = await supabase
                .from('upcoming_orders')
                .select('*')
                .in('status', ['scheduled', 'confirmed'])
                .order('created_at', { ascending: true });

            if (upcomingError) {
                throw new Error(`Failed to fetch upcoming orders: ${upcomingError.message}`);
            }

            if (!upcomingOrders || upcomingOrders.length === 0) {
                return NextResponse.json({
                    success: true,
                    message: 'No active orders found to process',
                    statistics: {
                        totalOrders: 0,
                        totalBillingRecords: 0,
                        totalValue: 0,
                        totalItems: 0
                    },
                    orders: [],
                    billingRecords: [],
                    processedAt: new Date().toISOString()
                }, { status: 200 });
            }

            ordersToProcess = upcomingOrders;
            isFromUpcomingOrders = true;
        } else {
            ordersToProcess = orders;
        }

        // Fetch all required reference data
        const [menuItems, vendors, boxTypes, settings] = await Promise.all([
            getMenuItems(),
            getVendors(),
            getBoxTypes(),
            getSettings()
        ]);

        const processedOrders: any[] = [];
        const billingRecords: any[] = [];
        const errors: string[] = [];

        // Process each order
        for (const order of ordersToProcess) {
            try {
                // Fetch client information
                const client = await getClient(order.client_id);
                if (!client) {
                    errors.push(`Client not found for order ${order.id}`);
                    continue;
                }

                // Get navigator name
                let navigatorName = 'Unassigned';
                if (client.navigatorId) {
                    const { data: navigator } = await supabase
                        .from('navigators')
                        .select('name')
                        .eq('id', client.navigatorId)
                        .single();
                    if (navigator) {
                        navigatorName = navigator.name;
                    }
                }

                // Fetch order details based on service type
                let orderSummary: any = {
                    orderId: order.id,
                    clientId: order.client_id,
                    clientName: client.fullName,
                    serviceType: order.service_type,
                    status: order.status,
                    caseId: order.case_id || null,
                    scheduledDeliveryDate: order.scheduled_delivery_date,
                    actualDeliveryDate: order.actual_delivery_date || null, // May not exist in upcoming_orders
                    deliveryDistribution: order.delivery_distribution || {},
                    totalValue: parseFloat(order.total_value?.toString() || '0'),
                    totalItems: parseInt(order.total_items?.toString() || '0'),
                    notes: order.notes || null,
                    createdAt: order.created_at,
                    lastUpdated: order.last_updated,
                    updatedBy: order.updated_by,
                    vendorDetails: [],
                    orderSource: isFromUpcomingOrders ? 'upcoming_orders' : 'orders'
                };

                if (order.service_type === 'Food') {
                    // Fetch vendor selections for Food orders (from orders or upcoming_orders)
                    const vendorSelectionsTable = isFromUpcomingOrders ? 'upcoming_order_vendor_selections' : 'order_vendor_selections';
                    const orderIdField = isFromUpcomingOrders ? 'upcoming_order_id' : 'order_id';
                    const itemsTable = isFromUpcomingOrders ? 'upcoming_order_items' : 'order_items';
                    const vendorSelectionIdField = isFromUpcomingOrders ? 'vendor_selection_id' : 'vendor_selection_id';

                    const { data: vendorSelections } = await supabase
                        .from(vendorSelectionsTable)
                        .select('*')
                        .eq(orderIdField, order.id);

                    if (vendorSelections) {
                        for (const vs of vendorSelections) {
                            const vendor = vendors.find(v => v.id === vs.vendor_id);
                            
                            // Fetch items for this vendor selection
                            const { data: items } = await supabase
                                .from(itemsTable)
                                .select('*')
                                .eq(vendorSelectionIdField, vs.id);

                            const vendorSummary: any = {
                                vendorId: vs.vendor_id,
                                vendorName: vendor?.name || 'Unknown Vendor',
                                items: []
                            };

                            let vendorTotalValue = 0;
                            let vendorTotalQuantity = 0;

                            if (items) {
                                for (const item of items) {
                                    const menuItem = menuItems.find(m => m.id === item.menu_item_id);
                                    vendorSummary.items.push({
                                        itemId: item.menu_item_id,
                                        itemName: menuItem?.name || 'Unknown Item',
                                        quantity: item.quantity,
                                        unitValue: parseFloat(item.unit_value?.toString() || '0'),
                                        totalValue: parseFloat(item.total_value?.toString() || '0')
                                    });
                                    vendorTotalValue += parseFloat(item.total_value?.toString() || '0');
                                    vendorTotalQuantity += item.quantity;
                                }
                            }

                            vendorSummary.totalValue = vendorTotalValue;
                            vendorSummary.totalQuantity = vendorTotalQuantity;
                            orderSummary.vendorDetails.push(vendorSummary);
                        }
                    }
                } else if (order.service_type === 'Boxes') {
                    // Fetch box selections for Box orders (from orders or upcoming_orders)
                    const boxSelectionsTable = isFromUpcomingOrders ? 'upcoming_order_box_selections' : 'order_box_selections';
                    const orderIdField = isFromUpcomingOrders ? 'upcoming_order_id' : 'order_id';

                    const { data: boxSelections } = await supabase
                        .from(boxSelectionsTable)
                        .select('*')
                        .eq(orderIdField, order.id);

                    if (boxSelections && boxSelections.length > 0) {
                        for (const bs of boxSelections) {
                            const boxType = boxTypes.find(b => b.id === bs.box_type_id);
                            const vendor = vendors.find(v => v.id === bs.vendor_id);
                            
                            orderSummary.vendorDetails.push({
                                vendorId: bs.vendor_id || null,
                                vendorName: vendor?.name || 'Unknown Vendor',
                                boxTypeId: bs.box_type_id,
                                boxTypeName: boxType?.name || 'Unknown Box Type',
                                quantity: bs.quantity
                            });
                        }
                    }
                }

                processedOrders.push(orderSummary);

                // Create billing record for this order
                const billingAmount = orderSummary.totalValue;
                const orderSource = isFromUpcomingOrders ? 'Upcoming Order' : 'Order';
                const billingRemarks = `${orderSource} #${order.id.substring(0, 8)} - ${order.service_type} service${order.case_id ? ` (Case: ${order.case_id})` : ''}`;

                const { data: billingRecord, error: billingError } = await supabase
                    .from('billing_records')
                    .insert({
                        client_id: order.client_id,
                        client_name: client.fullName,
                        status: 'request sent',
                        remarks: billingRemarks,
                        navigator: navigatorName,
                        amount: billingAmount
                    })
                    .select()
                    .single();

                if (billingError) {
                    errors.push(`Failed to create billing record for ${isFromUpcomingOrders ? 'upcoming order' : 'order'} ${order.id}: ${billingError.message}`);
                } else if (billingRecord) {
                    billingRecords.push({
                        id: billingRecord.id,
                        clientId: billingRecord.client_id,
                        clientName: billingRecord.client_name,
                        status: billingRecord.status,
                        remarks: billingRecord.remarks,
                        navigator: billingRecord.navigator,
                        amount: parseFloat(billingRecord.amount?.toString() || '0'),
                        createdAt: billingRecord.created_at,
                        orderId: order.id,
                        orderSource: isFromUpcomingOrders ? 'upcoming_orders' : 'orders'
                    });
                }

            } catch (error: any) {
                errors.push(`Error processing ${isFromUpcomingOrders ? 'upcoming order' : 'order'} ${order.id}: ${error.message}`);
            }
        }

        // Calculate aggregate statistics
        const stats = {
            totalOrders: processedOrders.length,
            totalBillingRecords: billingRecords.length,
            totalClients: new Set(processedOrders.map(o => o.clientId)).size,
            totalValue: processedOrders.reduce((sum, o) => sum + o.totalValue, 0),
            totalItems: processedOrders.reduce((sum, o) => sum + o.totalItems, 0),
            byServiceType: {
                Food: processedOrders.filter(o => o.serviceType === 'Food').length,
                Boxes: processedOrders.filter(o => o.serviceType === 'Boxes').length,
                'Cooking supplies': processedOrders.filter(o => o.serviceType === 'Cooking supplies').length,
                'Care plan': processedOrders.filter(o => o.serviceType === 'Care plan').length
            },
            byStatus: {
                pending: processedOrders.filter(o => o.status === 'pending').length,
                confirmed: processedOrders.filter(o => o.status === 'confirmed').length
            },
            byVendor: {} as Record<string, number>
        };

        // Count orders by vendor
        processedOrders.forEach(order => {
            order.vendorDetails.forEach((vendor: any) => {
                const vendorName = vendor.vendorName || 'Unknown';
                stats.byVendor[vendorName] = (stats.byVendor[vendorName] || 0) + 1;
            });
        });

        return NextResponse.json({
            success: true,
            message: `Successfully processed ${processedOrders.length} order(s) and created ${billingRecords.length} billing record(s)`,
            orderSource: isFromUpcomingOrders ? 'upcoming_orders' : 'orders',
            settings: {
                weeklyCutoffDay: settings.weeklyCutoffDay,
                weeklyCutoffTime: settings.weeklyCutoffTime
            },
            statistics: stats,
            orders: processedOrders,
            billingRecords: billingRecords,
            errors: errors.length > 0 ? errors : undefined,
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
