import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface OrderItem {
    itemId: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
}

interface VendorDayMismatch {
    clientId: string;
    clientName: string;
    serviceType: string;
    orderDeliveryDay: string;
    vendorId: string;
    vendorName: string;
    vendorSupportedDays: string[];
    source: 'active_order' | 'upcoming_orders';
    upcomingOrderId?: string;
    itemCount: number;
    items: OrderItem[];
}

/**
 * GET - Find all orders where the delivery day doesn't match vendor's supported days
 */
export async function GET() {
    try {
        // Get all vendors with their delivery days
        const { data: vendors, error: vendorError } = await supabase
            .from('vendors')
            .select('id, name, delivery_days');

        if (vendorError) throw vendorError;

        // Get menu items for name lookup
        const { data: menuItems } = await supabase
            .from('menu_items')
            .select('id, name, price_each, value');

        // Also get meal items for lookup (breakfast, lunch, dinner items)
        const { data: mealItems } = await supabase
            .from('meal_items')
            .select('id, name, price_each, value');

        const itemNameMap = new Map<string, string>();
        for (const mi of menuItems || []) {
            itemNameMap.set(mi.id, mi.name);
        }
        for (const mi of mealItems || []) {
            itemNameMap.set(mi.id, mi.name);
        }

        const vendorMap = new Map<string, { name: string; days: string[] }>();
        for (const v of vendors || []) {
            vendorMap.set(v.id, {
                name: v.name,
                days: v.delivery_days || []
            });
        }

        const mismatches: VendorDayMismatch[] = [];

        // 1. Check upcoming_orders table
        const { data: upcomingOrders, error: uoError } = await supabase
            .from('upcoming_orders')
            .select(`
                id,
                client_id,
                delivery_day,
                service_type,
                status,
                clients(full_name),
                upcoming_order_vendor_selections(vendor_id)
            `)
            .eq('status', 'scheduled')
            .not('delivery_day', 'is', null);

        if (uoError) throw uoError;

        for (const uo of upcomingOrders || []) {
            if (!uo.delivery_day || !uo.upcoming_order_vendor_selections) continue;

            for (const vs of uo.upcoming_order_vendor_selections) {
                if (!vs.vendor_id) continue;

                const vendor = vendorMap.get(vs.vendor_id);
                if (!vendor) continue;

                // Check if the order's delivery day is in the vendor's supported days
                if (vendor.days.length > 0 && !vendor.days.includes(uo.delivery_day)) {
                    mismatches.push({
                        clientId: uo.client_id,
                        clientName: (uo.clients as any)?.full_name || 'Unknown',
                        serviceType: uo.service_type || 'Food',
                        orderDeliveryDay: uo.delivery_day,
                        vendorId: vs.vendor_id,
                        vendorName: vendor.name,
                        vendorSupportedDays: vendor.days,
                        source: 'upcoming_orders',
                        upcomingOrderId: uo.id,
                        itemCount: 0,
                        items: []
                    });
                }
            }
        }

        // Get item details for the mismatches from upcoming_orders
        for (const m of mismatches.filter(x => x.source === 'upcoming_orders')) {
            const { data: orderItems } = await supabase
                .from('upcoming_order_items')
                .select('menu_item_id, meal_item_id, quantity, unit_value, total_value, menu_items(name), meal_items(name)')
                .eq('upcoming_order_id', m.upcomingOrderId!);

            if (orderItems) {
                m.items = orderItems.map((item: any) => ({
                    itemId: item.menu_item_id || item.meal_item_id || '',
                    itemName: item.menu_items?.name || item.meal_items?.name || 'Unknown Item',
                    quantity: item.quantity || 0,
                    unitPrice: item.unit_value || 0,
                    totalPrice: item.total_value || 0
                })).filter(i => i.quantity > 0);
                m.itemCount = m.items.length;
            }
        }

        // 2. Also check active_order in clients table for mismatches
        const { data: clients, error: clientError } = await supabase
            .from('clients')
            .select('id, full_name, active_order, service_type')
            .not('active_order', 'is', null);

        if (clientError) throw clientError;

        for (const client of clients || []) {
            const ao = client.active_order;
            if (!ao || typeof ao !== 'object') continue;

            // Check deliveryDayOrders format
            if (ao.deliveryDayOrders) {
                for (const [day, dayOrder] of Object.entries(ao.deliveryDayOrders)) {
                    const dOrder = dayOrder as any;
                    if (!dOrder?.vendorSelections) continue;

                    for (const vs of dOrder.vendorSelections) {
                        if (!vs.vendorId) continue;

                        const vendor = vendorMap.get(vs.vendorId);
                        if (!vendor) continue;

                        if (vendor.days.length > 0 && !vendor.days.includes(day)) {
                            const itemEntries = vs.items ? Object.entries(vs.items).filter(([, qty]) => (qty as number) > 0) : [];
                            if (itemEntries.length > 0) {
                                // Build items array from active_order
                                const orderItems: OrderItem[] = itemEntries.map(([itemId, qty]) => {
                                    const itemName = itemNameMap.get(itemId) || `Item ${itemId.substring(0, 8)}...`;
                                    const quantity = qty as number;
                                    return {
                                        itemId,
                                        itemName,
                                        quantity,
                                        unitPrice: 0,
                                        totalPrice: 0
                                    };
                                });

                                mismatches.push({
                                    clientId: client.id,
                                    clientName: client.full_name || 'Unknown',
                                    serviceType: ao.serviceType || client.service_type || 'Food',
                                    orderDeliveryDay: day,
                                    vendorId: vs.vendorId,
                                    vendorName: vendor.name,
                                    vendorSupportedDays: vendor.days,
                                    source: 'active_order',
                                    itemCount: orderItems.length,
                                    items: orderItems
                                });
                            }
                        }
                    }
                }
            }
        }

        // Dedupe by clientId + day + vendorId
        const seen = new Set<string>();
        const uniqueMismatches = mismatches.filter(m => {
            const key = `${m.clientId}-${m.orderDeliveryDay}-${m.vendorId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        return NextResponse.json({
            success: true,
            count: uniqueMismatches.length,
            mismatches: uniqueMismatches.sort((a, b) => a.clientName.localeCompare(b.clientName))
        });

    } catch (error: any) {
        console.error('[vendor-day-mismatches] Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
