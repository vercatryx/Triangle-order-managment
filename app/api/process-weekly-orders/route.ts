import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getMenuItems, getVendors, getBoxTypes, getSettings, getClient, appendOrderHistory, getNextCreationId } from '@/lib/actions';
import { randomUUID } from 'crypto';
import { getNextDeliveryDate, getTakeEffectDateLegacy } from '@/lib/order-dates';
import { getCurrentTime } from '@/lib/time';

/**
 * API Route: Process all current active orders from orders table
 *
 * GET /api/process-weekly-orders
 *
 * When orders table is empty: reads from clients.upcoming_order (single source of truth)
 * When orders table has records: fetches active orders from orders table
 * Creates billing records for each processed order
 */
/**
 * Generate a unique case_id for upcoming orders
 */
function generateUniqueCaseId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `CASE-${timestamp}-${random}`;
}

// Re-export for backward compatibility (deprecated, use order-dates.ts directly)
/** @deprecated Use getTakeEffectDateLegacy from order-dates.ts */
function calculateTakeEffectDate(vendorId: string, vendors: any[]): Date | null {
    return getTakeEffectDateLegacy(vendorId, vendors);
}

/**
 * Calculate scheduled delivery date (first occurrence of vendor delivery day)
 * @deprecated Use getNextDeliveryDate from order-dates.ts
 */
function calculateScheduledDeliveryDate(vendorId: string, vendors: any[]): Date | null {
    return getNextDeliveryDate(vendorId, vendors);
}


/**
 * Precheck: no longer reads from upcoming_orders table.
 * Order creation from clients.upcoming_order is handled by the Order sync tool.
 * This route only processes orders already in the orders table.
 */
async function precheckAndTransferUpcomingOrders(_creationId: number) {
    const transferResults = {
        transferred: 0,
        skipped: 0,
        errors: [] as string[]
    };
    return transferResults;
}


export async function GET(request: NextRequest) {
    try {
        // Get next creation_id for this batch
        const creationId = await getNextCreationId();
        
        // Precheck: Transfer upcoming orders for clients with no existing orders
        const precheckResults = await precheckAndTransferUpcomingOrders(creationId);

        // First, check if orders table is completely empty
        const { count: ordersCount, error: countError } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true });

        if (countError) {
            throw new Error(`Failed to check orders table: ${countError.message}`);
        }

        let ordersToProcess: any[] = [];
        let isFromUpcomingOrders = false;

        // If orders table is empty, fetch from clients.upcoming_order
        if (ordersCount === 0) {
            const { data: clientsWithUpcoming, error: clientsError } = await supabase
                .from('clients')
                .select('id, upcoming_order, service_type')
                .not('upcoming_order', 'is', null);

            if (clientsError) {
                throw new Error(`Failed to fetch clients with upcoming orders: ${clientsError.message}`);
            }

            // Expand clients.upcoming_order JSON into order-like records
            const expanded: any[] = [];
            for (const c of clientsWithUpcoming || []) {
                const uo = c.upcoming_order;
                if (!uo || typeof uo !== 'object') continue;
                const st = uo.serviceType || c.service_type || 'Food';
                const caseId = uo.caseId || null;

                if (st === 'Food' && uo.deliveryDayOrders && Object.keys(uo.deliveryDayOrders).length > 0) {
                    for (const day of Object.keys(uo.deliveryDayOrders)) {
                        const dayData = uo.deliveryDayOrders[day];
                        if (dayData?.vendorSelections?.length) {
                            expanded.push({
                                client_id: c.id,
                                service_type: 'Food',
                                case_id: caseId,
                                delivery_day: day,
                                _fromClientsUpcoming: true,
                                _config: {
                                    serviceType: 'Food',
                                    caseId,
                                    vendorSelections: dayData.vendorSelections,
                                    mealSelections: uo.mealSelections,
                                    notes: uo.notes
                                }
                            });
                        }
                    }
                    if (expanded.filter(e => e.client_id === c.id).length === 0 && (uo.vendorSelections?.length || uo.mealSelections)) {
                        expanded.push({
                            client_id: c.id,
                            service_type: 'Food',
                            case_id: caseId,
                            delivery_day: null,
                            _fromClientsUpcoming: true,
                            _config: { ...uo, serviceType: 'Food' }
                        });
                    }
                } else if (st === 'Boxes' && uo.boxOrders?.length) {
                    expanded.push({
                        client_id: c.id,
                        service_type: 'Boxes',
                        case_id: caseId,
                        delivery_day: null,
                        _fromClientsUpcoming: true,
                        _config: { ...uo, serviceType: 'Boxes' }
                    });
                } else if (st === 'Custom') {
                    expanded.push({
                        client_id: c.id,
                        service_type: 'Custom',
                        case_id: caseId,
                        delivery_day: uo.deliveryDay || null,
                        _fromClientsUpcoming: true,
                        _config: { ...uo, serviceType: 'Custom' }
                    });
                } else if (st === 'Meal' || uo.mealSelections || uo.vendorSelections) {
                    expanded.push({
                        client_id: c.id,
                        service_type: st === 'Meal' ? 'Meal' : 'Food',
                        case_id: caseId,
                        delivery_day: null,
                        _fromClientsUpcoming: true,
                        _config: { ...uo, serviceType: st }
                    });
                }
            }

            ordersToProcess = expanded;
            isFromUpcomingOrders = true;

            if (ordersToProcess.length === 0) {
                return NextResponse.json({
                    success: true,
                    message: 'No orders found to process. Orders table is empty and no clients have upcoming_order data.',
                    statistics: { totalOrders: 0, totalBillingRecords: 0, totalValue: 0, totalItems: 0 },
                    orders: [],
                    billingRecords: [],
                    processedAt: new Date().toISOString()
                }, { status: 200 });
            }
        } else {
            // Orders table has records, fetch active orders
            const { data: orders, error: ordersError } = await supabase
                .from('orders')
                .select('*')
                .in('status', ['pending', 'confirmed'])
                .order('created_at', { ascending: true });

            if (ordersError) {
                throw new Error(`Failed to fetch orders: ${ordersError.message}`);
            }

            if (!orders || orders.length === 0) {
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
                if (isFromUpcomingOrders && order.case_id) {
                    const { count: caseIdCount, error: caseIdError } = await supabase
                        .from('orders')
                        .select('*', { count: 'exact', head: true })
                        .eq('case_id', order.case_id);

                    if (caseIdError) {
                        errors.push(`Failed to check case_id: ${caseIdError.message}`);
                        continue;
                    }

                    if (caseIdCount && caseIdCount > 0) {
                        // Skip this order as case_id already exists in orders table
                        continue;
                    }
                }

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
                // Calculate scheduled_delivery_date from delivery_day if order is from upcoming_orders
                let scheduledDeliveryDate: string | null = null;
                if (isFromUpcomingOrders && (order as any).delivery_day) {
                    const deliveryDay = (order as any).delivery_day;
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const dayNameToNumber: { [key: string]: number } = {
                        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                        'Thursday': 4, 'Friday': 5, 'Saturday': 6
                    };
                    const targetDayNumber = dayNameToNumber[deliveryDay];
                    if (targetDayNumber !== undefined) {
                        // Find next occurrence of this day
                        for (let i = 1; i <= 7; i++) {
                            const checkDate = new Date(today);
                            checkDate.setDate(today.getDate() + i);
                            if (checkDate.getDay() === targetDayNumber) {
                                scheduledDeliveryDate = checkDate.toISOString().split('T')[0];
                                break;
                            }
                        }
                    }
                } else if (!isFromUpcomingOrders) {
                    scheduledDeliveryDate = (order as any).scheduled_delivery_date || null;
                }

                let orderSummary: any = {
                    orderId: (order as any).id ?? null,
                    clientId: order.client_id,
                    clientName: client.fullName,
                    serviceType: order.service_type,
                    status: order.status,
                    caseId: order.case_id || null,
                    scheduledDeliveryDate: scheduledDeliveryDate,
                    actualDeliveryDate: (order as any).actual_delivery_date || null, // May not exist in upcoming_orders
                    deliveryDistribution: (!isFromUpcomingOrders ? (order as any).delivery_distribution : null) || {},
                    totalValue: parseFloat(order.total_value?.toString() || '0'),
                    totalItems: parseInt(order.total_items?.toString() || '0'),
                    notes: order.notes || null,
                    createdAt: order.created_at,
                    lastUpdated: order.last_updated,
                    updatedBy: order.updated_by,
                    vendorDetails: [],
                    orderSource: isFromUpcomingOrders ? 'upcoming_orders' : 'orders'
                };

                const fromClientsUpcoming = !!(order as any)._fromClientsUpcoming;
                const config = (order as any)._config;

                if (fromClientsUpcoming && config) {
                    // Build vendorDetails from clients.upcoming_order config
                    if (order.service_type === 'Food' && config.vendorSelections) {
                        for (const vs of config.vendorSelections) {
                            const vendor = vendors.find((v: any) => v.id === vs.vendor_id);
                            let totalValue = 0;
                            const itemsList: any[] = [];
                            for (const [menuItemId, qty] of Object.entries(vs.items || {})) {
                                const mi = menuItems.find((m: any) => m.id === menuItemId);
                                const uv = mi ? parseFloat(mi.value?.toString() || '0') : 0;
                                const tv = uv * Number(qty);
                                totalValue += tv;
                                itemsList.push({ itemId: menuItemId, itemName: mi?.name || 'Unknown', quantity: qty, unitValue: uv, totalValue: tv });
                            }
                            orderSummary.vendorDetails.push({
                                vendorId: vs.vendor_id,
                                vendorName: vendor?.name || 'Unknown Vendor',
                                items: itemsList,
                                totalValue,
                                totalQuantity: itemsList.reduce((s, i) => s + Number(i.quantity), 0)
                            });
                        }
                    } else if (order.service_type === 'Boxes' && config.boxOrders) {
                        for (const box of config.boxOrders) {
                            const vendor = vendors.find((v: any) => v.id === box.vendorId);
                            orderSummary.vendorDetails.push({
                                vendorId: box.vendorId,
                                vendorName: vendor?.name || 'Unknown Vendor',
                                quantity: box.quantity || 1,
                                boxTypeId: box.boxTypeId
                            });
                        }
                    } else if (order.service_type === 'Custom') {
                        const vendor = vendors.find((v: any) => v.id === config.vendorId);
                        const cv = Number(config.custom_price) || 0;
                        orderSummary.vendorDetails.push({
                            vendorId: config.vendorId,
                            vendorName: vendor?.name || 'Unknown Vendor',
                            items: [{ itemName: config.custom_name || 'Custom', quantity: 1, totalValue: cv }],
                            totalValue: cv,
                            totalQuantity: 1
                        });
                    }
                    orderSummary.totalValue = orderSummary.vendorDetails.reduce((s: number, v: any) => s + (v.totalValue || 0), 0);
                    orderSummary.totalItems = orderSummary.vendorDetails.reduce((s: number, v: any) => s + (v.totalQuantity || v.quantity || 0), 0);
                } else if (order.service_type === 'Food') {
                    const vendorSelectionsTable = isFromUpcomingOrders ? 'upcoming_order_vendor_selections' : 'order_vendor_selections';
                    const orderIdField = isFromUpcomingOrders ? 'upcoming_order_id' : 'order_id';
                    const itemsTable = isFromUpcomingOrders ? 'upcoming_order_items' : 'order_items';
                    const vendorSelectionIdField = 'vendor_selection_id';

                    const { data: vendorSelections } = await supabase
                        .from(vendorSelectionsTable)
                        .select('*')
                        .eq(orderIdField, order.id);

                    if (vendorSelections) {
                        for (const vs of vendorSelections) {
                            const vendor = vendors.find((v: any) => v.id === vs.vendor_id);

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
                                    const menuItem = menuItems.find((m: any) => m.id === item.menu_item_id);
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
                            const vendor = vendors.find((v: any) => v.id === bs.vendor_id);

                            orderSummary.vendorDetails.push({
                                vendorId: bs.vendor_id || null,
                                vendorName: vendor?.name || 'Unknown Vendor',
                                quantity: bs.quantity,
                                boxTypeId: bs.box_type_id
                            });
                        }
                    }
                } else if (order.service_type === 'Custom') {
                    // Fetch vendor selections for Custom orders
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
                            const vendor = vendors.find((v: any) => v.id === vs.vendor_id);

                            const vendorSummary: any = {
                                vendorId: vs.vendor_id,
                                vendorName: vendor?.name || 'Unknown Vendor',
                                items: []
                            };

                            // Fetch items
                            const { data: items } = await supabase
                                .from(itemsTable)
                                .select('*')
                                .eq(vendorSelectionIdField, vs.id);

                            if (items) {
                                for (const item of items) {
                                    vendorSummary.items.push({
                                        itemId: null,
                                        itemName: item.custom_name || 'Custom Item',
                                        customName: item.custom_name,
                                        customPrice: item.custom_price,
                                        quantity: item.quantity,
                                        unitValue: 0,
                                        totalValue: 0
                                    });
                                }
                            }

                            vendorSummary.totalValue = parseFloat(order.total_value?.toString() || '0');
                            vendorSummary.totalQuantity = 1;

                            orderSummary.vendorDetails.push(vendorSummary);
                        }
                    }
                }

                processedOrders.push(orderSummary);

                // If processing from clients.upcoming_order or upcoming_orders, create/copy to orders table
                if (isFromUpcomingOrders) {
                    try {
                        const fromClientsUpcoming = !!(order as any)._fromClientsUpcoming;
                        const config = (order as any)._config;

                        let scheduledDeliveryDate: string | null = null;
                        if ((order as any).delivery_day) {
                            const deliveryDay = (order as any).delivery_day;
                            const today = await getCurrentTime();
                            today.setHours(0, 0, 0, 0);
                            const dayNameToNumber: { [key: string]: number } = {
                                'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                                'Thursday': 4, 'Friday': 5, 'Saturday': 6
                            };
                            const targetDayNumber = dayNameToNumber[deliveryDay];
                            if (targetDayNumber !== undefined) {
                                for (let i = 1; i <= 7; i++) {
                                    const checkDate = new Date(today);
                                    checkDate.setDate(today.getDate() + i);
                                    if (checkDate.getDay() === targetDayNumber) {
                                        scheduledDeliveryDate = checkDate.toISOString().split('T')[0];
                                        break;
                                    }
                                }
                            }
                        }

                        if (fromClientsUpcoming && config) {
                            // Create order from clients.upcoming_order config
                            let totalValue = 0;
                            let totalItems = 0;
                            if (order.service_type === 'Food' && config.vendorSelections) {
                                for (const vs of config.vendorSelections) {
                                    for (const [_, qty] of Object.entries(vs.items || {})) {
                                        totalItems += Number(qty) || 0;
                                    }
                                }
                            } else if (order.service_type === 'Boxes' && config.boxOrders) {
                                for (const b of config.boxOrders) {
                                    totalItems += (b.quantity || 1) * Object.values(b.items || {}).reduce((s: number, q: any) => s + (Number(q) || 0), 0);
                                }
                            }

                            const orderData: any = {
                                client_id: order.client_id,
                                service_type: order.service_type,
                                case_id: order.case_id,
                                status: 'pending',
                                last_updated: (await getCurrentTime()).toISOString(),
                                updated_by: null,
                                scheduled_delivery_date: scheduledDeliveryDate,
                                delivery_distribution: null,
                                total_value: totalValue,
                                total_items: totalItems,
                                notes: config.notes || null,
                                creation_id: creationId
                            };
                            if (order.service_type === 'Custom') {
                                orderData.notes = JSON.stringify({
                                    vendorId: config.vendorId,
                                    equipmentId: null,
                                    equipmentName: config.custom_name,
                                    price: Number(config.custom_price) || 0
                                });
                                orderData.total_value = Number(config.custom_price) || 0;
                                orderData.total_items = 1;
                            }

                            const { data: newOrder, error: orderError } = await supabase
                                .from('orders')
                                .insert(orderData)
                                .select()
                                .single();

                            if (orderError || !newOrder) {
                                errors.push(`Failed to create order from clients.upcoming_order: ${orderError?.message}`);
                            } else {
                                if (order.service_type === 'Food' && config.vendorSelections) {
                                    for (const vs of config.vendorSelections) {
                                        if (!vs.vendorId) continue;
                                        const { data: newVs } = await supabase.from('order_vendor_selections').insert({ order_id: newOrder.id, vendor_id: vs.vendorId }).select().single();
                                        if (newVs && vs.items) {
                                            for (const [menuItemId, qty] of Object.entries(vs.items)) {
                                                if (Number(qty) <= 0) continue;
                                                const mi = menuItems.find((m: any) => m.id === menuItemId);
                                                const uv = mi ? parseFloat(mi.value?.toString() || '0') : 0;
                                                await supabase.from('order_items').insert({
                                                    order_id: newOrder.id,
                                                    vendor_selection_id: newVs.id,
                                                    menu_item_id: menuItemId,
                                                    quantity: qty,
                                                    unit_value: uv,
                                                    total_value: uv * Number(qty)
                                                });
                                            }
                                        }
                                    }
                                } else if (order.service_type === 'Boxes' && config.boxOrders) {
                                    for (const box of config.boxOrders) {
                                        await supabase.from('order_box_selections').insert({
                                            order_id: newOrder.id,
                                            vendor_id: box.vendorId,
                                            box_type_id: box.boxTypeId,
                                            quantity: box.quantity || 1,
                                            items: box.items || {},
                                            item_notes: box.itemNotes || {}
                                        });
                                    }
                                } else if (order.service_type === 'Custom' && config.vendorId) {
                                    const { data: newVs } = await supabase.from('order_vendor_selections').insert({ order_id: newOrder.id, vendor_id: config.vendorId }).select().single();
                                    if (newVs) {
                                        await supabase.from('order_items').insert({
                                            order_id: newOrder.id,
                                            vendor_selection_id: newVs.id,
                                            menu_item_id: null,
                                            quantity: 1,
                                            unit_value: 0,
                                            total_value: 0,
                                            custom_name: config.custom_name,
                                            custom_price: String(config.custom_price || 0)
                                        });
                                    }
                                }
                                orderSummary.orderId = newOrder.id;
                                orderSummary.copiedFromUpcoming = true;
                            }
                        } else {
                        // Create order in orders table (copy from upcoming_orders)
                        const orderData: any = {
                            client_id: order.client_id,
                            service_type: order.service_type,
                            case_id: order.case_id,
                            status: 'pending',
                            last_updated: (await getCurrentTime()).toISOString(),
                            updated_by: order.updated_by,
                            scheduled_delivery_date: scheduledDeliveryDate,
                            delivery_distribution: null,
                            total_value: order.total_value,
                            total_items: order.total_items,
                            notes: order.notes || null,
                            creation_id: creationId
                        };

                        const { data: newOrder, error: orderError } = await supabase
                            .from('orders')
                            .insert(orderData)
                            .select()
                            .single();

                        if (orderError || !newOrder) {
                            errors.push(`Failed to copy upcoming order to orders table: ${orderError?.message}`);
                        } else {
                            let copyErrors: string[] = [];
                            let itemsCopied = 0;
                            let vendorSelectionsCopied = 0;
                            let boxSelectionsCopied = 0;

                            // Copy all related records:
                            // 1. order_vendor_selections (from upcoming_order_vendor_selections)
                            // 2. order_items (from upcoming_order_items)
                            // 3. order_box_selections (from upcoming_order_box_selections)

                            // Copy vendor selections and items (for Food orders)
                            if (order.service_type === 'Food') {
                                const { data: vendorSelections, error: vsFetchError } = await supabase
                                    .from('upcoming_order_vendor_selections')
                                    .select('*')
                                    .eq('upcoming_order_id', order.id);

                                if (vsFetchError) {
                                    copyErrors.push(`Failed to fetch vendor selections: ${vsFetchError.message}`);
                                } else if (vendorSelections && vendorSelections.length > 0) {
                                    for (const vs of vendorSelections) {
                                        const { data: newVs, error: vsError } = await supabase
                                            .from('order_vendor_selections')
                                            .insert({
                                                order_id: newOrder.id,
                                                vendor_id: vs.vendor_id
                                            })
                                            .select()
                                            .single();

                                        if (vsError || !newVs) {
                                            copyErrors.push(`Failed to copy vendor selection ${vs.id}: ${vsError?.message}`);
                                            continue;
                                        }

                                        vendorSelectionsCopied++;

                                        // Copy ALL items for this vendor selection from upcoming_order_items to order_items
                                        const { data: items, error: itemsFetchError } = await supabase
                                            .from('upcoming_order_items')
                                            .select('*')
                                            .eq('vendor_selection_id', vs.id);

                                        if (itemsFetchError) {
                                            copyErrors.push(`Failed to fetch items for vendor selection ${vs.id}: ${itemsFetchError.message}`);
                                        } else if (items && items.length > 0) {
                                            for (const item of items) {
                                                // Skip total items (menu_item_id is null) - we'll recalculate and add a new one
                                                if (item.menu_item_id !== null) {
                                                    const { error: itemError } = await supabase.from('order_items').insert({
                                                        order_id: newOrder.id,
                                                        vendor_selection_id: newVs.id,
                                                        menu_item_id: item.menu_item_id,
                                                        quantity: item.quantity,
                                                        unit_value: item.unit_value,
                                                        total_value: item.total_value
                                                    });

                                                    if (itemError) {
                                                        copyErrors.push(`Failed to copy item ${item.id}: ${itemError.message}`);
                                                    } else {
                                                        itemsCopied++;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                // Recalculate total from all items using unit_value * quantity (more reliable)
                                const { data: allOrderItems } = await supabase
                                    .from('order_items')
                                    .select('unit_value, quantity, custom_price')
                                    .eq('order_id', newOrder.id);

                                if (allOrderItems && allOrderItems.length > 0) {
                                    // Calculate from unit_value * quantity (same logic as getOrderById)
                                    const calculatedTotal = allOrderItems.reduce((sum, item) => {
                                        // Use custom_price if available, otherwise use unit_value * quantity
                                        const itemPrice = item.custom_price 
                                            ? parseFloat(item.custom_price.toString() || '0')
                                            : parseFloat(item.unit_value?.toString() || '0');
                                        const quantity = parseFloat(item.quantity?.toString() || '0');
                                        return sum + (itemPrice * quantity);
                                    }, 0);

                                    // Update order total_value if it differs
                                    if (Math.abs(calculatedTotal - parseFloat(newOrder.total_value || 0)) > 0.01) {
                                        await supabase
                                            .from('orders')
                                            .update({ total_value: calculatedTotal })
                                            .eq('id', newOrder.id);
                                    }

                                    // Add total as a separate item (use first vendor selection from new order)
                                    const { data: firstNewVs } = await supabase
                                        .from('order_vendor_selections')
                                        .select('id')
                                        .eq('order_id', newOrder.id)
                                        .limit(1)
                                        .maybeSingle();

                                    if (firstNewVs && calculatedTotal > 0) {
                                        await supabase.from('order_items').insert({
                                            order_id: newOrder.id,
                                            vendor_selection_id: firstNewVs.id,
                                            menu_item_id: null, // null indicates this is a total item
                                            quantity: 1,
                                            unit_value: calculatedTotal,
                                            total_value: calculatedTotal
                                        });
                                    }
                                }
                            }

                            // Copy box selections (for Box orders)
                            if (order.service_type === 'Boxes') {
                                const { data: boxSelections, error: bsFetchError } = await supabase
                                    .from('upcoming_order_box_selections')
                                    .select('*')
                                    .eq('upcoming_order_id', order.id);

                                if (bsFetchError) {
                                    copyErrors.push(`Failed to fetch box selections: ${bsFetchError.message}`);
                                } else if (boxSelections && boxSelections.length > 0) {
                                    for (const bs of boxSelections) {
                                        const { error: bsError } = await supabase.from('order_box_selections').insert({
                                            order_id: newOrder.id,
                                            vendor_id: bs.vendor_id,
                                            quantity: bs.quantity,
                                            unit_value: bs.unit_value || 0,
                                            total_value: bs.total_value || 0,
                                            items: bs.items || {}
                                        });

                                        if (bsError) {
                                            copyErrors.push(`Failed to copy box selection ${bs.id}: ${bsError.message}`);
                                        } else {
                                            boxSelectionsCopied++;
                                        }
                                    }
                                }
                            }

                            // Copy Custom Order Items (for Custom service type)
                            // We reuse order_items table but populated with custom_name/custom_price. 
                            if (order.service_type === 'Custom') {
                                const { data: vendorSelections, error: vsFetchError } = await supabase
                                    .from('upcoming_order_vendor_selections')
                                    .select('*')
                                    .eq('upcoming_order_id', order.id);

                                if (vsFetchError) {
                                    copyErrors.push(`Failed to fetch Custom vendor selections: ${vsFetchError.message}`);
                                } else if (vendorSelections && vendorSelections.length > 0) {
                                    for (const vs of vendorSelections) {
                                        const { data: newVs, error: vsError } = await supabase
                                            .from('order_vendor_selections') // Reusing this table for Custom orders too
                                            .insert({
                                                order_id: newOrder.id,
                                                vendor_id: vs.vendor_id
                                            })
                                            .select()
                                            .single();

                                        if (vsError || !newVs) {
                                            copyErrors.push(`Failed to copy Custom vendor selection: ${vsError?.message}`);
                                            continue;
                                        }

                                        vendorSelectionsCopied++;

                                        // Copy items (should be just one custom item usually)
                                        const { data: items, error: itemsFetchError } = await supabase
                                            .from('upcoming_order_items')
                                            .select('*')
                                            .eq('vendor_selection_id', vs.id);

                                        if (itemsFetchError) {
                                            copyErrors.push(`Failed to fetch Custom items: ${itemsFetchError.message}`);
                                        } else if (items) {
                                            for (const item of items) {
                                                const { error: itemError } = await supabase.from('order_items').insert({
                                                    order_id: newOrder.id,
                                                    vendor_selection_id: newVs.id,
                                                    menu_item_id: null,
                                                    quantity: item.quantity,
                                                    unit_value: 0,
                                                    total_value: 0,
                                                    custom_name: item.custom_name,
                                                    custom_price: item.custom_price
                                                });

                                                if (itemError) {
                                                    copyErrors.push(`Failed to copy Custom item: ${itemError.message}`);
                                                } else {
                                                    itemsCopied++;
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Log copy summary and any errors
                            if (copyErrors.length > 0) {
                                errors.push(`Copy errors for order ${order.id}: ${copyErrors.join('; ')}`);
                            }

                            // Log successful copy summary
                            const copySummary = [];
                            if (vendorSelectionsCopied > 0) copySummary.push(`${vendorSelectionsCopied} vendor selection(s)`);
                            if (itemsCopied > 0) copySummary.push(`${itemsCopied} item(s)`);
                            if (boxSelectionsCopied > 0) copySummary.push(`${boxSelectionsCopied} box selection(s)`);

                            if (copySummary.length > 0) {
                                console.log(`Successfully copied order ${order.id}: ${copySummary.join(', ')}`);
                            }

                            // Update existing upcoming order with new case_id but keep all other details
                            // Generate unique case_id for the updated upcoming order
                            const newCaseId = generateUniqueCaseId();

                            const currentTime = await getCurrentTime();
                            await supabase
                                .from('upcoming_orders')
                                .update({
                                    case_id: newCaseId,
                                    last_updated: currentTime.toISOString(),
                                    updated_by: order.updated_by || 'System',
                                    processed_order_id: newOrder.id,
                                    processed_at: currentTime.toISOString()
                                    // Keep status as 'scheduled' (don't change to 'processed')
                                    // Keep all other fields the same (scheduled_delivery_date, take_effect_date, etc.)
                                })
                                .eq('id', order.id);

                            // Update orderSummary with the new order ID
                            orderSummary.orderId = newOrder.id;
                            orderSummary.copiedFromUpcoming = true;
                        }
                        }
                    } catch (copyError: any) {
                        errors.push(`Error copying upcoming order ${order.id} to orders table: ${copyError.message}`);
                    }
                }

                // Create billing record for this order
                const billingAmount = orderSummary.totalValue;
                const orderSource = isFromUpcomingOrders ? 'Upcoming Order' : 'Order';
                // Use the new order ID if it was copied, otherwise use the original ID
                const orderIdForBilling = (orderSummary.copiedFromUpcoming && orderSummary.orderId) ? orderSummary.orderId : order.id;
                const billingRemarks = `${orderSource} #${orderIdForBilling.substring(0, 8)} - ${order.service_type} service${order.case_id ? ` (Case: ${order.case_id})` : ''}`;

                const { data: billingRecord, error: billingError } = await supabase
                    .from('billing_records')
                    .insert({
                        client_id: order.client_id,
                        client_name: client.fullName,
                        status: 'request sent',
                        remarks: billingRemarks,
                        navigator: navigatorName,
                        amount: billingAmount,
                        order_id: orderIdForBilling
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
                        orderId: orderIdForBilling,
                        orderSource: isFromUpcomingOrders ? 'upcoming_orders' : 'orders',
                        copiedFromUpcoming: orderSummary.copiedFromUpcoming || false
                    });
                }

                // After processing the order and creating billing record, create upcoming orders
                // One upcoming order per vendor with unique case_id and current order details
                try {
                    // Create upcoming orders for each vendor
                    if (order.service_type === 'Food' && orderSummary.vendorDetails.length > 0) {
                        // For Food orders, create one upcoming order per vendor
                        for (const vendorDetail of orderSummary.vendorDetails) {
                            if (!vendorDetail.vendorId) continue;

                            const vendor = vendors.find((v: any) => v.id === vendorDetail.vendorId);
                            if (!vendor) continue;

                            // Calculate take effect date and scheduled delivery date for this vendor
                            const takeEffectDate = calculateTakeEffectDate(vendorDetail.vendorId, vendors);
                            const scheduledDeliveryDate = calculateScheduledDeliveryDate(vendorDetail.vendorId, vendors);

                            if (!takeEffectDate || !scheduledDeliveryDate) {
                                errors.push(`Failed to calculate dates for vendor ${vendorDetail.vendorId} when creating upcoming order`);
                                continue;
                            }

                            // Generate unique case_id
                            const uniqueCaseId = generateUniqueCaseId();

                            // Create upcoming order
                            const upcomingOrderData: any = {
                                client_id: order.client_id,
                                service_type: order.service_type,
                                case_id: uniqueCaseId,
                                status: 'scheduled',
                                last_updated: (await getCurrentTime()).toISOString(),
                                updated_by: order.updated_by || 'System',
                                take_effect_date: takeEffectDate.toISOString().split('T')[0],
                                total_value: vendorDetail.totalValue || 0,
                                total_items: vendorDetail.totalQuantity || 0,
                                notes: order.notes || null
                            };

                            // Add delivery_day if we can determine it from the vendor
                            if (vendor && vendor.deliveryDays && vendor.deliveryDays.length > 0) {
                                upcomingOrderData.delivery_day = vendor.deliveryDays[0]; // Use first delivery day
                            }

                            const { data: newUpcomingOrder, error: upcomingOrderError } = await supabase
                                .from('upcoming_orders')
                                .insert(upcomingOrderData)
                                .select()
                                .single();

                            if (upcomingOrderError || !newUpcomingOrder) {
                                errors.push(`Failed to create upcoming order for vendor ${vendorDetail.vendorId}: ${upcomingOrderError?.message}`);
                                continue;
                            }

                            // Create vendor selection for this upcoming order
                            const { data: newVendorSelection, error: vsError } = await supabase
                                .from('upcoming_order_vendor_selections')
                                .insert({
                                    upcoming_order_id: newUpcomingOrder.id,
                                    vendor_id: vendorDetail.vendorId
                                })
                                .select()
                                .single();

                            if (vsError || !newVendorSelection) {
                                errors.push(`Failed to create vendor selection for upcoming order ${newUpcomingOrder.id}: ${vsError?.message}`);
                                continue;
                            }

                            // Copy items for this vendor from the processed order
                            if (vendorDetail.items && vendorDetail.items.length > 0) {
                                for (const item of vendorDetail.items) {
                                    const { error: itemError } = await supabase
                                        .from('upcoming_order_items')
                                        .insert({
                                            upcoming_order_id: newUpcomingOrder.id,
                                            vendor_selection_id: newVendorSelection.id,
                                            menu_item_id: item.itemId,
                                            quantity: item.quantity,
                                            unit_value: item.unitValue,
                                            total_value: item.totalValue
                                        });

                                    if (itemError) {
                                        errors.push(`Failed to copy item ${item.itemId} to upcoming order: ${itemError.message}`);
                                    }
                                }
                            }
                        }
                    } else if (order.service_type === 'Boxes' && orderSummary.vendorDetails.length > 0) {
                        // For Box orders, create one upcoming order per vendor
                        for (const vendorDetail of orderSummary.vendorDetails) {
                            const vendorId = vendorDetail.vendorId;
                            if (!vendorId) continue;

                            const vendor = vendors.find((v: any) => v.id === vendorId);
                            if (!vendor) continue;

                            // Calculate take effect date and scheduled delivery date for this vendor
                            const takeEffectDate = calculateTakeEffectDate(vendorId, vendors);
                            const scheduledDeliveryDate = calculateScheduledDeliveryDate(vendorId, vendors);

                            if (!takeEffectDate || !scheduledDeliveryDate) {
                                errors.push(`Failed to calculate dates for vendor ${vendorId} when creating upcoming order`);
                                continue;
                            }

                            // Generate unique case_id
                            const uniqueCaseId = generateUniqueCaseId();

                            // Calculate totals for this vendor's box selection
                            const boxType = boxTypes.find((b: any) => b.id === vendorDetail.boxTypeId);
                            const boxValue = boxType?.priceEach || 0;
                            const boxQuantity = vendorDetail.quantity || 0;
                            const totalValue = boxValue * boxQuantity;

                            // Create upcoming order
                            const upcomingOrderData: any = {
                                client_id: order.client_id,
                                service_type: order.service_type,
                                case_id: uniqueCaseId,
                                status: 'scheduled',
                                last_updated: (await getCurrentTime()).toISOString(),
                                updated_by: order.updated_by || 'System',
                                take_effect_date: takeEffectDate.toISOString().split('T')[0],
                                total_value: totalValue,
                                total_items: boxQuantity,
                                notes: order.notes || null
                            };

                            // Add delivery_day if we can determine it from the vendor
                            if (vendorDetail.deliveryDays && vendorDetail.deliveryDays.length > 0) {
                                upcomingOrderData.delivery_day = vendorDetail.deliveryDays[0]; // Use first delivery day
                            }

                            const { data: newUpcomingOrder, error: upcomingOrderError } = await supabase
                                .from('upcoming_orders')
                                .insert(upcomingOrderData)
                                .select()
                                .single();

                            if (upcomingOrderError || !newUpcomingOrder) {
                                errors.push(`Failed to create upcoming order for vendor ${vendorId}: ${upcomingOrderError?.message}`);
                                continue;
                            }

                            // Create box selection for this upcoming order
                            // Note: items should be copied from the original order's box selection if available
                            const { error: bsError } = await supabase
                                .from('upcoming_order_box_selections')
                                .insert({
                                    upcoming_order_id: newUpcomingOrder.id,
                                    vendor_id: vendorId,
                                    quantity: boxQuantity,
                                    unit_value: 0,
                                    total_value: 0,
                                    items: {} // Items should be copied from original order if needed
                                });

                            if (bsError) {
                                errors.push(`Failed to create box selection for upcoming order ${newUpcomingOrder.id}: ${bsError.message}`);
                            }
                        }
                    } else if (order.service_type === 'Custom') {
                        // Re-create upcoming order for Custom Type

                        let vendorId: string | null = null;
                        if (orderSummary.vendorDetails.length > 0) {
                            vendorId = orderSummary.vendorDetails[0].vendorId;
                        }

                        if (vendorId) {
                            const takeEffectDate = calculateTakeEffectDate(vendorId, vendors);

                            let deliveryDay = (order as any).delivery_day;
                            if (!deliveryDay) {
                                const vendor = vendors.find((v: any) => v.id === vendorId);
                                if (vendor && vendor.deliveryDays.length > 0) deliveryDay = vendor.deliveryDays[0];
                            }

                            const uniqueCaseId = generateUniqueCaseId();

                            const upcomingOrderData: any = {
                                client_id: order.client_id,
                                service_type: 'Custom',
                                case_id: uniqueCaseId,
                                status: 'scheduled',
                                last_updated: (await getCurrentTime()).toISOString(),
                                updated_by: order.updated_by || 'System',
                                take_effect_date: takeEffectDate ? takeEffectDate.toISOString().split('T')[0] : null,
                                total_value: order.total_value,
                                total_items: 1,
                                notes: order.notes,
                                delivery_day: deliveryDay
                            };

                            const { data: newUpcomingOrder, error: upcomingOrderError } = await supabase
                                .from('upcoming_orders')
                                .insert(upcomingOrderData)
                                .select()
                                .single();

                            if (upcomingOrderError || !newUpcomingOrder) {
                                errors.push(`Failed to recreate upcoming Custom order: ${upcomingOrderError?.message}`);
                            } else {
                                const { data: newVs, error: vsError } = await supabase
                                    .from('upcoming_order_vendor_selections')
                                    .insert({
                                        upcoming_order_id: newUpcomingOrder.id,
                                        vendor_id: vendorId
                                    })
                                    .select()
                                    .single();

                                if (!vsError && newVs) {
                                    // Try to get item details from orderSummary
                                    const item = orderSummary.vendorDetails[0]?.items[0];
                                    if (item) {
                                        await supabase.from('upcoming_order_items').insert({
                                            upcoming_order_id: newUpcomingOrder.id,
                                            vendor_selection_id: newVs.id,
                                            menu_item_id: null,
                                            quantity: 1,
                                            unit_value: 0,
                                            total_value: 0,
                                            custom_name: item.customName || item.itemName,
                                            custom_price: item.customPrice || order.total_value
                                        });
                                    }
                                }
                            }
                        }
                    }
                } catch (upcomingOrderError: any) {
                    errors.push(`Error creating upcoming orders for processed order ${order.id}: ${upcomingOrderError.message}`);
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

        const copiedCount = processedOrders.filter(o => o.copiedFromUpcoming).length;

        // Combine precheck errors with processing errors
        const allErrors = [...precheckResults.errors, ...errors];

        // Trigger local DB sync in background after processing orders
        const { triggerSyncInBackground } = await import('@/lib/local-db');
        triggerSyncInBackground();

        return NextResponse.json({
            success: true,
            message: `Successfully processed ${processedOrders.length} order(s)${copiedCount > 0 ? `, copied ${copiedCount} order(s) from upcoming_orders to orders table` : ''} and created ${billingRecords.length} billing record(s)`,
            precheck: {
                transferred: precheckResults.transferred,
                skipped: precheckResults.skipped,
                errors: precheckResults.errors.length > 0 ? precheckResults.errors : undefined
            },
            orderSource: isFromUpcomingOrders ? 'upcoming_orders' : 'orders',
            copiedFromUpcoming: copiedCount,
            settings: {
                weeklyCutoffDay: settings.weeklyCutoffDay,
                weeklyCutoffTime: settings.weeklyCutoffTime
            },
            statistics: stats,
            orders: processedOrders,
            billingRecords: billingRecords,
            errors: allErrors.length > 0 ? allErrors : undefined,
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
