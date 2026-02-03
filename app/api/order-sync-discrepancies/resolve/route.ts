import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

type Resolution = 'use_active_order' | 'use_upcoming_orders' | 'clear_both';

interface ResolveRequest {
    clientId: string;
    resolution: Resolution;
}

/**
 * POST - Resolve a sync discrepancy for a specific client
 */
export async function POST(request: NextRequest) {
    try {
        const body: ResolveRequest = await request.json();
        const { clientId, resolution } = body;

        if (!clientId || !resolution) {
            return NextResponse.json({
                success: false,
                error: 'clientId and resolution are required'
            }, { status: 400 });
        }

        console.log(`[API] Resolving discrepancy for client ${clientId}: ${resolution}`);

        // Get client data
        const { data: client, error: clientError } = await supabase
            .from('clients')
            .select('id, full_name, active_order, service_type')
            .eq('id', clientId)
            .single();

        if (clientError || !client) {
            return NextResponse.json({
                success: false,
                error: `Client not found: ${clientError?.message || 'Unknown'}`
            }, { status: 404 });
        }

        switch (resolution) {
            case 'use_active_order': {
                // Validate that active_order has enough data to create upcoming_orders
                const activeOrder = client.active_order;

                if (!activeOrder || typeof activeOrder !== 'object' || Object.keys(activeOrder).length === 0) {
                    return NextResponse.json({
                        success: false,
                        error: 'Active order is empty - nothing to sync'
                    }, { status: 400 });
                }

                // Check based on service type
                const serviceType = activeOrder.serviceType;
                let hasValidData = false;
                let validationError = '';

                if (serviceType === 'Food') {
                    // Food orders need vendorSelections with items OR deliveryDayOrders OR mealSelections
                    // Note: vendorId is optional (e.g., breakfast items don't need a vendor)
                    if (activeOrder.deliveryDayOrders) {
                        const days = Object.values(activeOrder.deliveryDayOrders) as any[];
                        hasValidData = days.some((dayOrder: any) =>
                            dayOrder?.vendorSelections?.some((vs: any) =>
                                vs.items && Object.keys(vs.items).length > 0
                            )
                        );
                        if (!hasValidData) validationError = 'No items found in delivery days';
                    } else if (activeOrder.vendorSelections) {
                        hasValidData = activeOrder.vendorSelections.some((vs: any) =>
                            vs.items && Object.keys(vs.items).length > 0
                        );
                        if (!hasValidData) validationError = 'No items found in vendor selections';
                    } else if (activeOrder.mealSelections) {
                        // Food service can also have mealSelections (breakfast, lunch, dinner)
                        const meals = Object.values(activeOrder.mealSelections) as any[];
                        hasValidData = meals.some((meal: any) =>
                            meal.items && Object.keys(meal.items).length > 0
                        );
                        if (!hasValidData) validationError = 'No items found in meal selections';
                    } else {
                        validationError = 'No order data found';
                    }
                } else if (serviceType === 'Boxes') {
                    // Boxes need boxOrders with boxTypeId
                    if (activeOrder.boxOrders && activeOrder.boxOrders.length > 0) {
                        hasValidData = activeOrder.boxOrders.some((box: any) => box.boxTypeId);
                        if (!hasValidData) validationError = 'Box orders missing box type';
                    } else if (activeOrder.boxTypeId) {
                        // Legacy single-box format
                        hasValidData = true;
                    } else {
                        validationError = 'No box orders found';
                    }
                } else if (serviceType === 'Meal') {
                    // Meal orders need mealSelections with items (vendorId is optional)
                    if (activeOrder.mealSelections) {
                        const meals = Object.values(activeOrder.mealSelections) as any[];
                        hasValidData = meals.some((meal: any) =>
                            meal.items && Object.keys(meal.items).length > 0
                        );
                        if (!hasValidData) validationError = 'No meal selections with items found';
                    } else {
                        validationError = 'No meal selections found';
                    }
                } else if (serviceType === 'Custom') {
                    // Custom orders just need a description/name
                    hasValidData = !!(activeOrder.custom_name || activeOrder.description);
                    if (!hasValidData) validationError = 'Custom order has no description';
                } else if (serviceType) {
                    // Unknown service type with data - allow it
                    hasValidData = true;
                } else {
                    validationError = 'No service type specified in active order';
                }

                if (!hasValidData) {
                    return NextResponse.json({
                        success: false,
                        error: `Cannot sync: ${validationError}. The active_order data is incomplete.`
                    }, { status: 400 });
                }

                // Now safe to sync
                const { syncCurrentOrderToUpcoming } = await import('@/lib/actions');

                const clientProfile = {
                    id: client.id,
                    fullName: client.full_name,
                    serviceType: client.service_type,
                    activeOrder: client.active_order
                } as any;

                try {
                    await syncCurrentOrderToUpcoming(clientId, clientProfile, false, true);

                    return NextResponse.json({
                        success: true,
                        message: `Successfully synced active_order to upcoming_orders for ${client.full_name}`,
                        resolution
                    });
                } catch (syncError: any) {
                    return NextResponse.json({
                        success: false,
                        error: `Sync failed: ${syncError.message}`
                    }, { status: 500 });
                }
            }

            case 'use_upcoming_orders': {
                // Get upcoming orders for this client
                const { data: upcomingOrders, error: uoError } = await supabase
                    .from('upcoming_orders')
                    .select('*')
                    .eq('client_id', clientId)
                    .eq('status', 'scheduled');

                if (uoError || !upcomingOrders || upcomingOrders.length === 0) {
                    return NextResponse.json({
                        success: false,
                        error: 'No scheduled upcoming orders found to sync from'
                    }, { status: 400 });
                }

                // Get vendor selections and items for the upcoming orders
                const upcomingOrderIds = upcomingOrders.map(o => o.id);

                const [vendorSelections, items, boxSelections] = await Promise.all([
                    supabase.from('upcoming_order_vendor_selections').select('*').in('upcoming_order_id', upcomingOrderIds),
                    supabase.from('upcoming_order_items').select('*').in('upcoming_order_id', upcomingOrderIds),
                    supabase.from('upcoming_order_box_selections').select('*').in('upcoming_order_id', upcomingOrderIds)
                ]);

                // Build active_order structure from upcoming_orders
                let activeOrderConfig: any;

                if (upcomingOrders.length === 1) {
                    const order = upcomingOrders[0];
                    activeOrderConfig = {
                        id: order.id,
                        serviceType: order.service_type === 'Meal' ? 'Food' : order.service_type,
                        caseId: order.case_id,
                        status: order.status
                    };

                    const orderVS = vendorSelections.data?.filter(vs => vs.upcoming_order_id === order.id) || [];

                    if (order.service_type === 'Food' || order.service_type === 'Meal') {
                        if (order.service_type === 'Meal' && order.meal_type) {
                            // Meal order - use mealSelections format
                            const mealType = order.meal_type || 'Lunch';
                            const mealItems: any = {};

                            if (orderVS.length > 0) {
                                const vs = orderVS[0];
                                const vsItems = items.data?.filter(item => item.vendor_selection_id === vs.id) || [];
                                vsItems.forEach(item => {
                                    const itemId = item.meal_item_id || item.menu_item_id;
                                    if (itemId) mealItems[itemId] = item.quantity;
                                });
                                activeOrderConfig.mealSelections = {
                                    [mealType]: { vendorId: vs.vendor_id, items: mealItems }
                                };
                            }
                        } else {
                            // Food order - use vendorSelections format
                            activeOrderConfig.vendorSelections = orderVS.map(vs => {
                                const vsItems = items.data?.filter(item => item.vendor_selection_id === vs.id) || [];
                                const itemsMap: any = {};
                                vsItems.forEach(item => {
                                    const itemId = item.menu_item_id || item.meal_item_id;
                                    if (itemId) itemsMap[itemId] = item.quantity;
                                });
                                return { vendorId: vs.vendor_id, items: itemsMap };
                            });
                        }
                    } else if (order.service_type === 'Boxes') {
                        const boxSel = boxSelections.data?.find(bs => bs.upcoming_order_id === order.id);
                        if (boxSel) {
                            activeOrderConfig.vendorId = boxSel.vendor_id;
                            activeOrderConfig.boxTypeId = boxSel.box_type_id;
                            activeOrderConfig.boxQuantity = boxSel.quantity;
                            activeOrderConfig.items = boxSel.items || {};
                        }
                    }
                } else {
                    // Multiple orders - use deliveryDayOrders format
                    const firstOrder = upcomingOrders[0];
                    activeOrderConfig = {
                        id: firstOrder.id,
                        serviceType: firstOrder.service_type,
                        caseId: firstOrder.case_id,
                        deliveryDayOrders: {}
                    };

                    for (const order of upcomingOrders) {
                        const deliveryDay = order.delivery_day || 'default';
                        const orderVS = vendorSelections.data?.filter(vs => vs.upcoming_order_id === order.id) || [];

                        activeOrderConfig.deliveryDayOrders[deliveryDay] = {
                            vendorSelections: orderVS.map(vs => {
                                const vsItems = items.data?.filter(item => item.vendor_selection_id === vs.id) || [];
                                const itemsMap: any = {};
                                vsItems.forEach(item => {
                                    const itemId = item.menu_item_id || item.meal_item_id;
                                    if (itemId) itemsMap[itemId] = item.quantity;
                                });
                                return { vendorId: vs.vendor_id, items: itemsMap };
                            })
                        };
                    }
                }

                // Update clients.active_order
                const { error: updateError } = await supabase
                    .from('clients')
                    .update({
                        active_order: activeOrderConfig,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', clientId);

                if (updateError) {
                    return NextResponse.json({
                        success: false,
                        error: `Failed to update active_order: ${updateError.message}`
                    }, { status: 500 });
                }

                return NextResponse.json({
                    success: true,
                    message: `Successfully synced upcoming_orders to active_order for ${client.full_name}`,
                    resolution
                });
            }

            case 'clear_both': {
                // Clear active_order
                const { error: clearActiveError } = await supabase
                    .from('clients')
                    .update({
                        active_order: {},
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', clientId);

                if (clearActiveError) {
                    return NextResponse.json({
                        success: false,
                        error: `Failed to clear active_order: ${clearActiveError.message}`
                    }, { status: 500 });
                }

                // Delete upcoming orders (mark as cancelled)
                const { error: deleteUpcomingError } = await supabase
                    .from('upcoming_orders')
                    .update({ status: 'cancelled' })
                    .eq('client_id', clientId)
                    .eq('status', 'scheduled');

                if (deleteUpcomingError) {
                    return NextResponse.json({
                        success: false,
                        error: `Failed to clear upcoming_orders: ${deleteUpcomingError.message}`
                    }, { status: 500 });
                }

                return NextResponse.json({
                    success: true,
                    message: `Successfully cleared both active_order and upcoming_orders for ${client.full_name}`,
                    resolution
                });
            }

            default:
                return NextResponse.json({
                    success: false,
                    error: `Invalid resolution type: ${resolution}`
                }, { status: 400 });
        }

    } catch (error: any) {
        console.error('[API] Error resolving discrepancy:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
