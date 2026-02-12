import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { getMenuItems, getVendors, getBoxTypes, getMealItems } from '@/lib/actions';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export interface ItemDetail {
    name: string;
    quantity: number;
    note?: string;
}

export interface VendorSelection {
    vendorName: string;
    items: ItemDetail[];
}

export interface BoxOrderDetail {
    boxTypeName: string;
    vendorName?: string;
    quantity: number;
    items: ItemDetail[];
}

export interface DiscrepancyClient {
    clientId: string;
    clientName: string;
    serviceType: string;
    discrepancyType: 'active_order_only' | 'upcoming_orders_only' | 'both_exist_mismatch';
    activeOrderDetails: {
        exists: boolean;
        serviceType?: string;
        caseId?: string;
        notes?: string;
        vendorSelections?: VendorSelection[];
        boxOrders?: BoxOrderDetail[];
        mealSelections?: { [mealType: string]: VendorSelection };
        deliveryDays?: string[];
        rawData?: any; // Full raw data for debugging
    };
    upcomingOrderDetails: {
        exists: boolean;
        orders?: {
            id: string;
            deliveryDay?: string;
            serviceType?: string;
            caseId?: string;
            vendorSelections?: VendorSelection[];
            boxOrder?: BoxOrderDetail;
            itemCount: number;
        }[];
    };
}

/**
 * GET - Fetch all clients with sync discrepancies between active_order and upcoming_orders
 */
export async function GET(request: NextRequest) {
    try {
        console.log('[API] Fetching order sync discrepancies with full details...');

        // Fetch lookup data for names
        const [menuItems, vendors, boxTypes, mealItems] = await Promise.all([
            getMenuItems(),
            getVendors(),
            getBoxTypes(),
            getMealItems()
        ]);

        const menuItemsById = new Map(menuItems.map((m: { id: string }) => [m.id, m]));
        const vendorsById = new Map(vendors.map((v: { id: string }) => [v.id, v]));
        const boxTypesById = new Map(boxTypes.map((b: { id: string }) => [b.id, b]));
        const mealItemsById = new Map(mealItems.map((m: { id: string }) => [m.id, m]));

        // Get all clients with their active_order
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('id, full_name, service_type, active_order');

        if (clientsError) {
            throw new Error(`Failed to fetch clients: ${clientsError.message}`);
        }

        // Get all scheduled upcoming orders
        const { data: upcomingOrders, error: upcomingError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('status', 'scheduled');

        if (upcomingError) {
            throw new Error(`Failed to fetch upcoming orders: ${upcomingError.message}`);
        }

        // Get vendor selections, box selections, and items for all upcoming orders
        const upcomingOrderIds = upcomingOrders?.map((o: { id: string }) => o.id) || [];
        let vendorSelections: any[] = [];
        let boxSelections: any[] = [];
        let orderItems: any[] = [];

        if (upcomingOrderIds.length > 0) {
            const [vsData, bsData, itemsData] = await Promise.all([
                supabase.from('upcoming_order_vendor_selections').select('*').in('upcoming_order_id', upcomingOrderIds),
                supabase.from('upcoming_order_box_selections').select('*').in('upcoming_order_id', upcomingOrderIds),
                supabase.from('upcoming_order_items').select('*').in('upcoming_order_id', upcomingOrderIds)
            ]);
            vendorSelections = vsData.data || [];
            boxSelections = bsData.data || [];
            orderItems = itemsData.data || [];
        }

        // Group upcoming orders by client
        const upcomingByClient: Record<string, any[]> = {};
        upcomingOrders?.forEach((order: { id: string; client_id: string; delivery_day?: string; service_type?: string; case_id?: string }) => {
            if (!upcomingByClient[order.client_id]) {
                upcomingByClient[order.client_id] = [];
            }

            // Get vendor selections for this order
            const orderVS = vendorSelections.filter((vs: { upcoming_order_id?: string }) => vs.upcoming_order_id === order.id);
            const orderBS = boxSelections.find((bs: { upcoming_order_id?: string }) => bs.upcoming_order_id === order.id);
            const vsWithItems = orderVS.map((vs: { id?: string; vendor_id?: string }) => {
                const vsItems = orderItems.filter((item: { vendor_selection_id?: string }) => item.vendor_selection_id === vs.id);
                return {
                    vendorName: (vendorsById.get(vs.vendor_id) as { name?: string } | undefined)?.name || vs.vendor_id || 'Unknown Vendor',
                    items: vsItems.map((item: { menu_item_id?: string; meal_item_id?: string; quantity?: number; notes?: string }) => {
                        const menuItem = (menuItemsById.get(item.menu_item_id) || mealItemsById.get(item.meal_item_id)) as { name?: string } | undefined;
                        return {
                            name: menuItem?.name || item.menu_item_id || item.meal_item_id || 'Unknown Item',
                            quantity: item.quantity,
                            note: item.notes
                        };
                    })
                };
            });

            let boxOrder: BoxOrderDetail | undefined;
            if (orderBS) {
                boxOrder = {
                    boxTypeName: (boxTypesById.get(orderBS.box_type_id) as { name?: string } | undefined)?.name || orderBS.box_type_id || 'Unknown Box',
                    vendorName: (vendorsById.get(orderBS.vendor_id) as { name?: string } | undefined)?.name,
                    quantity: orderBS.quantity || 1,
                    items: Object.entries(orderBS.items || {}).map(([itemId, qty]) => {
                        const menuItem = menuItemsById.get(itemId) as { name?: string } | undefined;
                        return {
                            name: menuItem?.name || itemId,
                            quantity: qty as number
                        };
                    })
                };
            }

            const itemCount = orderItems.filter((item: { vendor_selection_id?: string; upcoming_order_id?: string }) =>
                orderVS.some((vs: { id?: string }) => vs.id === item.vendor_selection_id) || item.upcoming_order_id === order.id
            ).length;

            upcomingByClient[order.client_id].push({
                id: order.id,
                deliveryDay: order.delivery_day,
                serviceType: order.service_type,
                caseId: order.case_id,
                vendorSelections: vsWithItems,
                boxOrder,
                itemCount
            });
        });

        // Find discrepancies
        const discrepancies: DiscrepancyClient[] = [];

        for (const client of clients || []) {
            const activeOrder = client.active_order;
            const hasActiveOrder = activeOrder &&
                typeof activeOrder === 'object' &&
                Object.keys(activeOrder).length > 0;

            const clientUpcomingOrders = upcomingByClient[client.id] || [];
            const hasUpcomingOrders = clientUpcomingOrders.length > 0;

            // Only flag as discrepancy if one exists without the other
            if (hasActiveOrder !== hasUpcomingOrders) {
                let discrepancyType: DiscrepancyClient['discrepancyType'];

                if (hasActiveOrder && !hasUpcomingOrders) {
                    discrepancyType = 'active_order_only';
                } else {
                    discrepancyType = 'upcoming_orders_only';
                }

                // Build active order details
                const activeOrderDetails: DiscrepancyClient['activeOrderDetails'] = {
                    exists: hasActiveOrder
                };

                if (hasActiveOrder) {
                    activeOrderDetails.serviceType = activeOrder.serviceType;
                    activeOrderDetails.caseId = activeOrder.caseId;
                    activeOrderDetails.notes = activeOrder.notes;
                    activeOrderDetails.rawData = activeOrder;

                    // Parse vendor selections
                    if (activeOrder.vendorSelections && activeOrder.vendorSelections.length > 0) {
                        activeOrderDetails.vendorSelections = activeOrder.vendorSelections.map((vs: any) => ({
                            vendorName: (vendorsById.get(vs.vendorId) as { name?: string } | undefined)?.name || vs.vendorId || 'Unknown Vendor',
                            items: Object.entries(vs.items || {}).map(([itemId, qty]) => {
                                const menuItem = (menuItemsById.get(itemId) || mealItemsById.get(itemId)) as { name?: string } | undefined;
                                return {
                                    name: menuItem?.name || itemId,
                                    quantity: qty as number,
                                    note: vs.itemNotes?.[itemId]
                                };
                            })
                        }));
                    }

                    // Parse delivery day orders
                    if (activeOrder.deliveryDayOrders) {
                        activeOrderDetails.deliveryDays = Object.keys(activeOrder.deliveryDayOrders);
                        // Flatten all vendor selections from all days
                        const allVS: VendorSelection[] = [];
                        Object.entries(activeOrder.deliveryDayOrders).forEach(([day, dayData]: [string, any]) => {
                            (dayData.vendorSelections || []).forEach((vs: any) => {
                                allVS.push({
                                    vendorName: `${(vendorsById.get(vs.vendorId) as { name?: string } | undefined)?.name || vs.vendorId || 'Unknown'} (${day})`,
                                    items: Object.entries(vs.items || {}).map(([itemId, qty]) => {
                                        const menuItem = menuItemsById.get(itemId) as { name?: string } | undefined;
                                        return {
                                            name: menuItem?.name || itemId,
                                            quantity: qty as number,
                                            note: vs.itemNotes?.[itemId]
                                        };
                                    })
                                });
                            });
                        });
                        if (allVS.length > 0) {
                            activeOrderDetails.vendorSelections = allVS;
                        }
                    }

                    // Parse box orders
                    if (activeOrder.boxOrders && activeOrder.boxOrders.length > 0) {
                        activeOrderDetails.boxOrders = activeOrder.boxOrders.map((box: any) => ({
                            boxTypeName: (boxTypesById.get(box.boxTypeId) as { name?: string } | undefined)?.name || box.boxTypeId || 'Unknown Box',
                            vendorName: (vendorsById.get(box.vendorId) as { name?: string } | undefined)?.name,
                            quantity: box.quantity || 1,
                            items: Object.entries(box.items || {}).map(([itemId, qty]) => {
                                const menuItem = menuItemsById.get(itemId) as { name?: string } | undefined;
                                return {
                                    name: menuItem?.name || itemId,
                                    quantity: qty as number,
                                    note: box.itemNotes?.[itemId]
                                };
                            })
                        }));
                    }

                    // Legacy single box
                    if (activeOrder.boxTypeId && !activeOrderDetails.boxOrders) {
                        activeOrderDetails.boxOrders = [{
                            boxTypeName: (boxTypesById.get(activeOrder.boxTypeId) as { name?: string } | undefined)?.name || activeOrder.boxTypeId || 'Unknown Box',
                            vendorName: (vendorsById.get(activeOrder.vendorId) as { name?: string } | undefined)?.name,
                            quantity: activeOrder.boxQuantity || 1,
                            items: Object.entries(activeOrder.items || {}).map(([itemId, qty]) => ({
                                name: (menuItemsById.get(itemId) as { name?: string } | undefined)?.name || itemId,
                                quantity: qty as number
                            }))
                        }];
                    }

                    // Parse meal selections
                    if (activeOrder.mealSelections) {
                        activeOrderDetails.mealSelections = {};
                        Object.entries(activeOrder.mealSelections).forEach(([mealType, mealData]: [string, any]) => {
                            activeOrderDetails.mealSelections![mealType] = {
                                vendorName: (vendorsById.get(mealData.vendorId) as { name?: string } | undefined)?.name || mealData.vendorId || 'No Vendor',
                                items: Object.entries(mealData.items || {}).map(([itemId, qty]) => {
                                    const item = (mealItemsById.get(itemId) || menuItemsById.get(itemId)) as { name?: string } | undefined;
                                    return {
                                        name: item?.name || itemId,
                                        quantity: qty as number,
                                        note: mealData.itemNotes?.[itemId]
                                    };
                                })
                            };
                        });
                    }
                }

                // Build upcoming orders details
                const upcomingOrderDetails: DiscrepancyClient['upcomingOrderDetails'] = {
                    exists: hasUpcomingOrders
                };

                if (hasUpcomingOrders) {
                    upcomingOrderDetails.orders = clientUpcomingOrders;
                }

                discrepancies.push({
                    clientId: client.id,
                    clientName: client.full_name,
                    serviceType: client.service_type || 'Unknown',
                    discrepancyType,
                    activeOrderDetails,
                    upcomingOrderDetails
                });
            }
        }

        // Sort by client name
        discrepancies.sort((a, b) => a.clientName.localeCompare(b.clientName));

        console.log(`[API] Found ${discrepancies.length} clients with discrepancies`);

        return NextResponse.json({
            success: true,
            count: discrepancies.length,
            discrepancies
        });

    } catch (error: any) {
        console.error('[API] Error fetching discrepancies:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
