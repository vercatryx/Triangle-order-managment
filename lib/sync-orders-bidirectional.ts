/**
 * Bidirectional sync between clients.active_order and upcoming_orders table
 * 
 * This ensures that:
 * 1. If order exists in clients.active_order but not in upcoming_orders → sync to upcoming_orders
 * 2. If order exists in upcoming_orders but not in clients.active_order → sync to clients.active_order
 */

import { createClient } from '@supabase/supabase-js';
import { getVendors, getMenuItems, getBoxTypes } from './actions';
import { getCurrentTime } from './time';
import type { ClientProfile } from './types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

interface SyncResult {
    clientId: string;
    clientName: string;
    direction: 'active_order_to_upcoming' | 'upcoming_to_active_order' | 'both';
    success: boolean;
    error?: string;
}

/**
 * Sync active_order to upcoming_orders for a client
 */
async function syncActiveOrderToUpcoming(clientId: string, client: any): Promise<{ success: boolean; error?: string }> {
    try {
        const activeOrder = client.active_order;
        if (!activeOrder || typeof activeOrder !== 'object' || Object.keys(activeOrder).length === 0) {
            return { success: false, error: 'No active_order found' };
        }

        // Use the existing syncCurrentOrderToUpcoming function
        const { syncCurrentOrderToUpcoming } = await import('./actions');
        
        // Map client to ClientProfile format
        const clientProfile = {
            id: client.id,
            fullName: client.full_name,
            serviceType: client.service_type,
            activeOrder: activeOrder
        } as any;

        await syncCurrentOrderToUpcoming(clientId, clientProfile, false, true); // skipHistory = true for bulk sync
        
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * Sync upcoming_orders to active_order for a client
 */
async function syncUpcomingToActiveOrder(clientId: string, upcomingOrders: any[]): Promise<{ success: boolean; error?: string }> {
    try {
        if (!upcomingOrders || upcomingOrders.length === 0) {
            return { success: false, error: 'No upcoming orders found' };
        }

        // Fetch vendor selections and items for all upcoming orders
        const upcomingOrderIds = upcomingOrders.map(o => o.id);
        
        const { data: vendorSelections } = await supabase
            .from('upcoming_order_vendor_selections')
            .select('*')
            .in('upcoming_order_id', upcomingOrderIds);

        const { data: items } = await supabase
            .from('upcoming_order_items')
            .select('*')
            .in('upcoming_order_id', upcomingOrderIds);

        const { data: boxSelections } = await supabase
            .from('upcoming_order_box_selections')
            .select('*')
            .in('upcoming_order_id', upcomingOrderIds);

        // Build active_order structure from upcoming_orders
        const menuItems = await getMenuItems();
        const vendors = await getVendors();
        const boxTypes = await getBoxTypes();

        // If multiple orders, use deliveryDayOrders format
        // If single order, use simple format
        let activeOrderConfig: any;

        if (upcomingOrders.length === 1) {
            const order = upcomingOrders[0];
            activeOrderConfig = {
                id: order.id,
                serviceType: order.service_type === 'Meal' ? 'Food' : order.service_type, // Meal orders use Food serviceType
                caseId: order.case_id,
                status: order.status
            };

            if (order.service_type === 'Food' || order.service_type === 'Meal') {
                // For Meal orders, check if we need mealSelections format
                if (order.service_type === 'Meal' && order.meal_type) {
                    // Meal order - use mealSelections format
                    const orderVS = vendorSelections?.filter(vs => vs.upcoming_order_id === order.id) || [];
                    const mealType = order.meal_type || 'Lunch';
                    const mealItems: any = {};
                    
                    if (orderVS.length > 0) {
                        const vs = orderVS[0];
                        const vsItems = items?.filter(item => item.vendor_selection_id === vs.id) || [];
                        vsItems.forEach(item => {
                            const itemId = item.meal_item_id || item.menu_item_id;
                            if (itemId) {
                                mealItems[itemId] = item.quantity;
                            }
                        });
                        activeOrderConfig.mealSelections = {
                            [mealType]: {
                                vendorId: vs.vendor_id,
                                items: mealItems
                            }
                        };
                    } else {
                        // No vendor selection - items might be orphaned
                        const allItems = items?.filter(item => item.upcoming_order_id === order.id) || [];
                        allItems.forEach(item => {
                            const itemId = item.meal_item_id || item.menu_item_id;
                            if (itemId) {
                                mealItems[itemId] = item.quantity;
                            }
                        });
                        if (Object.keys(mealItems).length > 0) {
                            activeOrderConfig.mealSelections = {
                                [mealType]: {
                                    vendorId: null,
                                    items: mealItems
                                }
                            };
                        }
                    }
                } else {
                    // Food order - use vendorSelections format
                    const orderVS = vendorSelections?.filter(vs => vs.upcoming_order_id === order.id) || [];
                    activeOrderConfig.vendorSelections = orderVS.map(vs => {
                        const vsItems = items?.filter(item => item.vendor_selection_id === vs.id) || [];
                        const itemsMap: any = {};
                        vsItems.forEach(item => {
                            const itemId = item.menu_item_id || item.meal_item_id;
                            if (itemId) {
                                itemsMap[itemId] = item.quantity;
                            }
                        });
                        return {
                            vendorId: vs.vendor_id,
                            items: itemsMap
                        };
                    });
                    
                    // If no vendor selections but items exist, create empty vendor selection
                    if (activeOrderConfig.vendorSelections.length === 0) {
                        const allItems = items?.filter(item => item.upcoming_order_id === order.id) || [];
                        if (allItems.length > 0) {
                            const itemsMap: any = {};
                            allItems.forEach(item => {
                                const itemId = item.menu_item_id || item.meal_item_id;
                                if (itemId) {
                                    itemsMap[itemId] = item.quantity;
                                }
                            });
                            if (Object.keys(itemsMap).length > 0) {
                                activeOrderConfig.vendorSelections = [{
                                    vendorId: null,
                                    items: itemsMap
                                }];
                            }
                        }
                    }
                }
            } else if (order.service_type === 'Boxes') {
                const boxSel = boxSelections?.find(bs => bs.upcoming_order_id === order.id);
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
                const orderVS = vendorSelections?.filter(vs => vs.upcoming_order_id === order.id) || [];
                
                activeOrderConfig.deliveryDayOrders[deliveryDay] = {
                    vendorSelections: orderVS.map(vs => {
                        const vsItems = items?.filter(item => item.vendor_selection_id === vs.id) || [];
                        const itemsMap: any = {};
                        vsItems.forEach(item => {
                            const itemId = item.menu_item_id || item.meal_item_id;
                            if (itemId) {
                                itemsMap[itemId] = item.quantity;
                            }
                        });
                        return {
                            vendorId: vs.vendor_id,
                            items: itemsMap
                        };
                    })
                };
            }
        }

        // Update clients.active_order
        const currentTime = await getCurrentTime();
        const { error: updateError } = await supabase
            .from('clients')
            .update({
                active_order: activeOrderConfig,
                updated_at: currentTime.toISOString()
            })
            .eq('id', clientId);

        if (updateError) {
            return { success: false, error: updateError.message };
        }

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * Sync all clients bidirectionally
 */
export async function syncAllOrdersBidirectional(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    console.log('Starting bidirectional sync...');

    // Get all clients
    const { data: clients, error: clientsError } = await supabase
        .from('clients')
        .select('id, full_name, service_type, active_order');

    if (clientsError) {
        throw new Error(`Failed to fetch clients: ${clientsError.message}`);
    }

    console.log(`Found ${clients?.length || 0} clients to check`);

    for (const client of clients || []) {
        const clientId = client.id;
        const clientName = client.full_name;

        // Check if client has active_order
        const hasActiveOrder = client.active_order && 
            typeof client.active_order === 'object' && 
            Object.keys(client.active_order).length > 0;

        // Check if client has upcoming_orders
        const { data: upcomingOrders } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('client_id', clientId)
            .eq('status', 'scheduled');

        const hasUpcomingOrders = upcomingOrders && upcomingOrders.length > 0;

        // Determine sync direction
        if (hasActiveOrder && !hasUpcomingOrders) {
            // Sync active_order → upcoming_orders
            console.log(`Syncing ${clientName} (${clientId}): active_order → upcoming_orders`);
            const result = await syncActiveOrderToUpcoming(clientId, client);
            results.push({
                clientId,
                clientName,
                direction: 'active_order_to_upcoming',
                success: result.success,
                error: result.error
            });
        } else if (hasUpcomingOrders && !hasActiveOrder) {
            // Sync upcoming_orders → active_order
            console.log(`Syncing ${clientName} (${clientId}): upcoming_orders → active_order`);
            const result = await syncUpcomingToActiveOrder(clientId, upcomingOrders);
            results.push({
                clientId,
                clientName,
                direction: 'upcoming_to_active_order',
                success: result.success,
                error: result.error
            });
        } else if (hasActiveOrder && hasUpcomingOrders) {
            // Both exist - check if they're actually in sync
            // Check if upcoming_orders has the required data (vendor selections, box selections, items)
            const upcomingOrderIds = upcomingOrders.map(o => o.id);
            
            const [vendorSelections, boxSelections, items] = await Promise.all([
                supabase.from('upcoming_order_vendor_selections').select('id').in('upcoming_order_id', upcomingOrderIds),
                supabase.from('upcoming_order_box_selections').select('id').in('upcoming_order_id', upcomingOrderIds),
                supabase.from('upcoming_order_items').select('id').in('upcoming_order_id', upcomingOrderIds)
            ]);

            const hasVendorSelections = (vendorSelections.data?.length || 0) > 0;
            const hasBoxSelections = (boxSelections.data?.length || 0) > 0;
            const hasItems = (items.data?.length || 0) > 0;

            // Check if any order is missing critical data
            const needsResync = upcomingOrders.some(order => {
                if (order.service_type === 'Boxes') {
                    // Boxes orders need box selections and items
                    return !hasBoxSelections || !hasItems;
                } else {
                    // Food/Meal orders need vendor selections and items
                    return !hasVendorSelections || !hasItems;
                }
            });

            if (needsResync) {
                console.log(`Re-syncing ${clientName} (${clientId}): upcoming_orders missing data, syncing from active_order`);
                const result = await syncActiveOrderToUpcoming(clientId, client);
                results.push({
                    clientId,
                    clientName,
                    direction: 'active_order_to_upcoming',
                    success: result.success,
                    error: result.error
                });
            } else {
                // Both exist and are in sync
                results.push({
                    clientId,
                    clientName,
                    direction: 'both',
                    success: true
                });
            }
        }
        // If neither exists, skip
    }

    return results;
}
