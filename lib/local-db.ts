'use server';

import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { getMenuItems, getVendors, getBoxTypes } from './actions';

interface LocalOrdersDB {
    orders: any[];
    upcomingOrders: any[];
    orderVendorSelections: any[];
    orderItems: any[];
    orderBoxSelections: any[];
    upcomingOrderVendorSelections: any[];
    upcomingOrderItems: any[];
    upcomingOrderBoxSelections: any[];
    lastSynced: string;
}

const DB_PATH = path.join(process.cwd(), 'data', 'local-orders-db.json');

// Ensure data directory exists and initialize DB file if it doesn't exist
async function ensureDBFile(): Promise<boolean> {
    const dataDir = path.join(process.cwd(), 'data');
    try {
        await fs.access(dataDir);
    } catch {
        try {
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error: any) {
            // If we can't create the directory (e.g., read-only filesystem in serverless), skip file operations
            if (error.code === 'EROFS' || error.code === 'EACCES') {
                return false;
            }
            throw error;
        }
    }

    try {
        await fs.access(DB_PATH);
    } catch {
        // Initialize empty database
        const initialDB: LocalOrdersDB = {
            orders: [],
            upcomingOrders: [],
            orderVendorSelections: [],
            orderItems: [],
            orderBoxSelections: [],
            upcomingOrderVendorSelections: [],
            upcomingOrderItems: [],
            upcomingOrderBoxSelections: [],
            lastSynced: new Date().toISOString()
        };
        try {
            await fs.writeFile(DB_PATH, JSON.stringify(initialDB, null, 2));
        } catch (error: any) {
            // If we can't write (e.g., read-only filesystem in serverless), skip file operations
            if (error.code === 'EROFS' || error.code === 'EACCES') {
                return false;
            }
            throw error;
        }
    }
    return true;
}

// Read local database
export async function readLocalDB(): Promise<LocalOrdersDB> {
    const canWrite = await ensureDBFile();
    if (!canWrite) {
        // Return empty DB if filesystem is read-only (e.g., in serverless environment)
        return {
            orders: [],
            upcomingOrders: [],
            orderVendorSelections: [],
            orderItems: [],
            orderBoxSelections: [],
            upcomingOrderVendorSelections: [],
            upcomingOrderItems: [],
            upcomingOrderBoxSelections: [],
            lastSynced: new Date().toISOString()
        };
    }
    try {
        const content = await fs.readFile(DB_PATH, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        // Return empty DB if read fails
        return {
            orders: [],
            upcomingOrders: [],
            orderVendorSelections: [],
            orderItems: [],
            orderBoxSelections: [],
            upcomingOrderVendorSelections: [],
            upcomingOrderItems: [],
            upcomingOrderBoxSelections: [],
            lastSynced: new Date().toISOString()
        };
    }
}

// Write to local database
async function writeLocalDB(db: LocalOrdersDB): Promise<void> {
    const canWrite = await ensureDBFile();
    if (!canWrite) {
        // Silently skip write if filesystem is read-only (e.g., in serverless environment)
        // The local DB is just a cache, so this is fine
        return;
    }
    try {
        db.lastSynced = new Date().toISOString();
        await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
    } catch (error: any) {
        // Silently skip write errors (e.g., read-only filesystem in serverless)
        // The local DB is just a cache, so this is fine
        if (error.code !== 'EROFS' && error.code !== 'EACCES') {
            // Only log non-permission errors for debugging
            console.warn('Error writing local DB (non-permission error):', error);
        }
    }
}

// Check if local DB needs sync (if it's empty or stale > 2 minutes)
async function needsSync(): Promise<boolean> {
    try {
        const db = await readLocalDB();
        // Always sync if DB is completely empty
        if (db.orders.length === 0 && db.upcomingOrders.length === 0) {
            return true; // Empty DB needs sync
        }
        // Check if last sync was more than 2 minutes ago
        const lastSynced = new Date(db.lastSynced);
        const now = new Date();
        const diffMinutes = (now.getTime() - lastSynced.getTime()) / (1000 * 60);
        return diffMinutes > 2; // Sync if older than 2 minutes for better freshness
    } catch {
        return true; // Error reading DB, needs sync
    }
}

// Trigger sync in background (non-blocking)
export async function triggerSyncInBackground(): Promise<void> {
    // Use setImmediate or setTimeout to run in background
    // This function returns immediately, sync runs asynchronously
    if (typeof setImmediate !== 'undefined') {
        setImmediate(() => {
            syncLocalDBFromSupabase().catch(err => {
                console.error('Background sync error:', err);
            });
        });
    } else {
        setTimeout(() => {
            syncLocalDBFromSupabase().catch(err => {
                console.error('Background sync error:', err);
            });
        }, 0);
    }
}

// Sync all orders and upcoming orders from Supabase to local DB
export async function syncLocalDBFromSupabase(): Promise<void> {
    try {
        let supabaseClient = supabase;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (serviceRoleKey) {
            supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
                auth: { persistSession: false }
            });
        }


        // Fetch all orders with status pending, confirmed, or processing
        const { data: orders, error: ordersError } = await supabaseClient
            .from('orders')
            .select('*')
            .in('status', ['pending', 'confirmed', 'processing']);

        if (ordersError) {
            console.error('Error fetching orders:', ordersError);
            throw ordersError;
        }

        // Fetch all scheduled upcoming orders
        const { data: upcomingOrders, error: upcomingOrdersError } = await supabaseClient
            .from('upcoming_orders')
            .select('*')
            .eq('status', 'scheduled');

        if (upcomingOrdersError) {
            console.error('Error fetching upcoming orders:', upcomingOrdersError);
            throw upcomingOrdersError;
        }

        // Fetch related data for orders
        const orderIds = (orders || []).map(o => o.id);
        let orderVendorSelections: any[] = [];
        let orderItems: any[] = [];
        let orderBoxSelections: any[] = [];

        if (orderIds.length > 0) {
            // Fetch vendor selections
            const { data: vsData } = await supabaseClient
                .from('order_vendor_selections')
                .select('*')
                .in('order_id', orderIds);

            orderVendorSelections = vsData || [];

            // Fetch items for these vendor selections
            const vsIds = orderVendorSelections.map(vs => vs.id);
            if (vsIds.length > 0) {
                const { data: itemsData } = await supabaseClient
                    .from('order_items')
                    .select('*')
                    .in('vendor_selection_id', vsIds);

                orderItems = itemsData || [];
            }

            // Fetch box selections
            const { data: boxData } = await supabaseClient
                .from('order_box_selections')
                .select('*')
                .in('order_id', orderIds);

            orderBoxSelections = boxData || [];
        }

        // Fetch related data for upcoming orders
        const upcomingOrderIds = (upcomingOrders || []).map(o => o.id);
        let upcomingOrderVendorSelections: any[] = [];
        let upcomingOrderItems: any[] = [];
        let upcomingOrderBoxSelections: any[] = [];

        if (upcomingOrderIds.length > 0) {
            // Fetch vendor selections
            const { data: uvsData } = await supabaseClient
                .from('upcoming_order_vendor_selections')
                .select('*')
                .in('upcoming_order_id', upcomingOrderIds);

            upcomingOrderVendorSelections = uvsData || [];

            // Fetch items for these vendor selections
            const uvsIds = upcomingOrderVendorSelections.map(vs => vs.id);
            if (uvsIds.length > 0) {
                const { data: uitemsData } = await supabaseClient
                    .from('upcoming_order_items')
                    .select('*')
                    .in('vendor_selection_id', uvsIds);

                upcomingOrderItems = uitemsData || [];
            }

            // Fetch box selections
            const { data: uboxData } = await supabaseClient
                .from('upcoming_order_box_selections')
                .select('*')
                .in('upcoming_order_id', upcomingOrderIds);

            upcomingOrderBoxSelections = uboxData || [];
        }

        // Update local database
        const localDB: LocalOrdersDB = {
            orders: orders || [],
            upcomingOrders: upcomingOrders || [],
            orderVendorSelections,
            orderItems,
            orderBoxSelections,
            upcomingOrderVendorSelections,
            upcomingOrderItems,
            upcomingOrderBoxSelections,
            lastSynced: new Date().toISOString()
        };


        await writeLocalDB(localDB);
        // console.log(`Local DB synced successfully. Orders: ${orders?.length || 0}, Upcoming Orders: ${upcomingOrders?.length || 0}`);
    } catch (error: any) {
        // Don't throw errors - local DB is just a cache
        // File system errors (read-only filesystem in serverless) can be silently ignored
        if (error.code === 'EROFS' || error.code === 'EACCES') {
            // Silently ignore read-only filesystem errors in serverless environments
            return;
        }
        // Log other errors (e.g., Supabase query errors) but don't fail the operation
        console.warn('Error syncing local DB:', error);
    }
}

// Get active order for client from local DB
export async function getActiveOrderForClientLocal(clientId: string) {
    if (!clientId) return null;

    try {
        // Check if sync is needed and trigger background sync
        if (await needsSync()) {
            triggerSyncInBackground();
        }

        const db = await readLocalDB();

        // Calculate current week range (Sunday to Saturday)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const day = today.getDay();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - day);
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        const startOfWeekStr = startOfWeek.toISOString().split('T')[0];
        const endOfWeekStr = endOfWeek.toISOString().split('T')[0];
        const startOfWeekISO = startOfWeek.toISOString();
        const endOfWeekISO = endOfWeek.toISOString();

        // Try to get all orders with scheduled_delivery_date in current week
        // Now supports multiple orders per client (one per delivery day)
        let orders = db.orders.filter(o =>
            o.client_id === clientId &&
            ['pending', 'confirmed', 'processing'].includes(o.status) &&
            o.scheduled_delivery_date >= startOfWeekStr &&
            o.scheduled_delivery_date <= endOfWeekStr
        );

        // If no orders found, try by created_at or last_updated
        if (orders.length === 0) {
            orders = db.orders.filter(o => {
                if (o.client_id !== clientId || !['pending', 'confirmed', 'processing'].includes(o.status)) {
                    return false;
                }
                const createdAt = new Date(o.created_at);
                const lastUpdated = new Date(o.last_updated);
                return (createdAt >= startOfWeek && createdAt <= endOfWeek) ||
                    (lastUpdated >= startOfWeek && lastUpdated <= endOfWeek);
            });
        }

        // If no orders found in orders table, check upcoming_orders as fallback
        // This handles cases where orders haven't been processed yet
        if (orders.length === 0) {
            const upcomingOrders = db.upcomingOrders.filter(o =>
                o.client_id === clientId &&
                o.status === 'scheduled'
            );

            if (upcomingOrders.length > 0) {
                // Convert upcoming orders to order format for display
                orders = upcomingOrders.map((uo: any) => ({
                    id: uo.id,
                    client_id: uo.client_id,
                    service_type: uo.service_type,
                    case_id: uo.case_id,
                    status: 'scheduled', // Use 'scheduled' status for upcoming orders
                    last_updated: uo.last_updated,
                    updated_by: uo.updated_by,
                    scheduled_delivery_date: uo.scheduled_delivery_date,
                    created_at: uo.created_at,
                    delivery_distribution: uo.delivery_distribution,
                    total_value: uo.total_value,
                    total_items: uo.total_items,
                    notes: uo.notes,
                    delivery_day: uo.delivery_day, // Include delivery_day if present
                    is_upcoming: true // Flag to indicate this is from upcoming_orders
                }));
            }
        }

        if (orders.length === 0) {
            return null;
        }

        // Sort by created_at descending
        orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        // Fetch reference data (these should already be cached)
        const menuItems = await getMenuItems();
        const vendors = await getVendors();
        const boxTypes = await getBoxTypes();

        // Process all orders
        const processOrder = (order: any) => {
            // Build order configuration object
            const orderConfig: any = {
                id: order.id,
                serviceType: order.service_type,
                caseId: order.case_id,
                status: order.status,
                lastUpdated: order.last_updated,
                updatedBy: order.updated_by,
                scheduledDeliveryDate: order.scheduled_delivery_date,
                createdAt: order.created_at,
                deliveryDistribution: order.delivery_distribution,
                totalValue: order.total_value,
                totalItems: order.total_items,
                notes: order.notes,
                deliveryDay: order.delivery_day, // Include delivery_day if present
                isUpcoming: order.is_upcoming || false // Flag for upcoming orders
            };

            // Determine which tables to query based on whether this is an upcoming order
            const vendorSelections = order.is_upcoming
                ? db.upcomingOrderVendorSelections.filter(vs => vs.upcoming_order_id === order.id)
                : db.orderVendorSelections.filter(vs => vs.order_id === order.id);

            if (order.service_type === 'Food') {
                // Get vendor selections for this order

                if (vendorSelections.length > 0) {
                    orderConfig.vendorSelections = [];
                    for (const vs of vendorSelections) {
                        // Get items for this vendor selection
                        const items = order.is_upcoming
                            ? db.upcomingOrderItems.filter(item => item.upcoming_vendor_selection_id === vs.id)
                            : db.orderItems.filter(item => item.vendor_selection_id === vs.id);
                        const itemsMap: any = {};
                        for (const item of items) {
                            itemsMap[item.menu_item_id] = item.quantity;
                        }

                        orderConfig.vendorSelections.push({
                            vendorId: vs.vendor_id,
                            items: itemsMap
                        });
                    }
                } else {
                    orderConfig.vendorSelections = [];
                }
            } else if (order.service_type === 'Boxes') {
                // Get box selection for this order
                const boxSelection = order.is_upcoming
                    ? db.upcomingOrderBoxSelections.find(bs => bs.upcoming_order_id === order.id)
                    : db.orderBoxSelections.find(bs => bs.order_id === order.id);
                if (boxSelection) {
                    orderConfig.vendorId = boxSelection.vendor_id;
                    orderConfig.boxTypeId = boxSelection.box_type_id;
                    orderConfig.boxQuantity = boxSelection.quantity;
                    // Load box items - handle both old format (itemId -> quantity) and new format (itemId -> { quantity, price })
                    const itemsRaw = boxSelection.items || {};
                    const items: any = {};
                    const itemPrices: any = {};
                    for (const [itemId, value] of Object.entries(itemsRaw)) {
                        if (typeof value === 'number') {
                            // Old format: just quantity
                            items[itemId] = value;
                        } else if (value && typeof value === 'object' && 'quantity' in value) {
                            // New format: { quantity, price? }
                            items[itemId] = (value as any).quantity;
                            if ('price' in value && (value as any).price !== undefined && (value as any).price !== null) {
                                itemPrices[itemId] = (value as any).price;
                            }
                        }
                    }
                    orderConfig.items = items;
                    if (Object.keys(itemPrices).length > 0) {
                        orderConfig.itemPrices = itemPrices;
                    }
                }
            }

            return orderConfig;
        };

        const processedOrders = orders.map(processOrder);

        // If only one order, return it in the old format for backward compatibility
        if (processedOrders.length === 1) {
            return processedOrders[0];
        }

        // If multiple orders, return them as an object with multiple flag
        return {
            multiple: true,
            orders: processedOrders
        };
    } catch (error) {
        console.error('Error in getActiveOrderForClientLocal:', error);
        return null;
    }
}

// Get upcoming order for client from local DB
export async function getUpcomingOrderForClientLocal(clientId: string) {
    if (!clientId) return null;

    try {
        // Check if sync is needed and trigger background sync
        if (await needsSync()) {
            triggerSyncInBackground();
        }

        const db = await readLocalDB();

        // Get all scheduled upcoming orders for this client
        const upcomingOrders = db.upcomingOrders
            .filter(o => o.client_id === clientId && o.status === 'scheduled')
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        if (upcomingOrders.length === 0) {
            return null;
        }

        // Fetch reference data (these should already be cached)
        const menuItems = await getMenuItems();
        const vendors = await getVendors();
        const boxTypes = await getBoxTypes();

        // If there's only one order and it doesn't have a delivery_day, return it in the old format for backward compatibility
        if (upcomingOrders.length === 1 && !upcomingOrders[0].delivery_day) {
            const data = upcomingOrders[0];
            const orderConfig: any = {
                id: data.id,
                serviceType: data.service_type,
                caseId: data.case_id,
                status: data.status,
                lastUpdated: data.last_updated,
                updatedBy: data.updated_by,
                scheduledDeliveryDate: data.scheduled_delivery_date,
                takeEffectDate: data.take_effect_date,
                deliveryDistribution: data.delivery_distribution,
                totalValue: data.total_value,
                totalItems: data.total_items,
                notes: data.notes
            };

            if (data.service_type === 'Food') {
                const vendorSelections = db.upcomingOrderVendorSelections.filter(vs => vs.upcoming_order_id === data.id);
                if (vendorSelections.length > 0) {
                    orderConfig.vendorSelections = [];
                    for (const vs of vendorSelections) {
                        const items = db.upcomingOrderItems.filter(item => item.vendor_selection_id === vs.id);
                        const itemsMap: any = {};
                        for (const item of items) {
                            itemsMap[item.menu_item_id] = item.quantity;
                        }
                        orderConfig.vendorSelections.push({
                            vendorId: vs.vendor_id,
                            items: itemsMap
                        });
                    }
                }
            } else if (data.service_type === 'Boxes') {
                const boxSelection = db.upcomingOrderBoxSelections.find(bs => bs.upcoming_order_id === data.id);
                if (boxSelection) {
                    orderConfig.vendorId = boxSelection.vendor_id;
                    orderConfig.boxTypeId = boxSelection.box_type_id;
                    orderConfig.boxQuantity = boxSelection.quantity;
                    const itemsRaw = boxSelection.items || {};
                    const items: any = {};
                    const itemPrices: any = {};
                    for (const [itemId, value] of Object.entries(itemsRaw)) {
                        if (typeof value === 'number') {
                            items[itemId] = value;
                        } else if (value && typeof value === 'object' && 'quantity' in value) {
                            items[itemId] = (value as any).quantity;
                            if ('price' in value && (value as any).price !== undefined && (value as any).price !== null) {
                                itemPrices[itemId] = (value as any).price;
                            }
                        }
                    }
                    orderConfig.items = items;
                    if (Object.keys(itemPrices).length > 0) {
                        orderConfig.itemPrices = itemPrices;
                    }
                }
            } else if (data.service_type === 'Meal') {
                const vendorSelections = db.upcomingOrderVendorSelections.filter(vs => vs.upcoming_order_id === data.id);
                orderConfig.mealSelections = {};

                if (vendorSelections.length > 0) {
                    const vs = vendorSelections[0];
                    const items = db.upcomingOrderItems.filter(item => item.vendor_selection_id === vs.id);
                    const mealItems: any = {};
                    for (const item of items) {
                        const itemId = item.meal_item_id || item.menu_item_id;
                        if (itemId) mealItems[itemId] = item.quantity;
                    }
                    orderConfig.mealSelections[data.meal_type || 'Lunch'] = {
                        vendorId: vs.vendor_id,
                        items: mealItems
                    };
                }
            }
            return orderConfig;
        }

        // New format: return orders grouped by delivery day
        // Structure: { [deliveryDay]: OrderConfiguration }
        const ordersByDeliveryDay: any = {};

        for (const data of upcomingOrders) {
            const deliveryDay = data.delivery_day || 'default';
            const mealType = data.meal_type || 'Lunch'; // Default to Lunch if not specified

            // Initialize order config if not exists for this day
            if (!ordersByDeliveryDay[deliveryDay]) {
                ordersByDeliveryDay[deliveryDay] = {
                    id: data.id, // Use ID of first order encountered (usually main/Lunch)
                    serviceType: data.service_type === 'Meal' ? 'Food' : data.service_type,
                    caseId: data.case_id,
                    status: data.status,
                    lastUpdated: data.last_updated,
                    updatedBy: data.updated_by,
                    scheduledDeliveryDate: data.scheduled_delivery_date,
                    takeEffectDate: data.take_effect_date,
                    deliveryDistribution: data.delivery_distribution,
                    totalValue: 0, // Will sum up
                    totalItems: 0, // Will sum up
                    notes: data.notes,
                    deliveryDay: deliveryDay === 'default' ? null : deliveryDay,
                    vendorSelections: [], // Initialize for robustness
                    mealSelections: {}
                };
            }

            const currentConfig = ordersByDeliveryDay[deliveryDay];

            // Accumulate totals
            // Note: If we are merging multiple orders, we sum their values/items
            // But we only set common fields (like caseId) once (from the first one, or overwrite if needed)
            // Ideally, caseId shouldn't differ.

            // CAUTION: totalValue in DB is per-row. We need to aggregate them for the UI?
            // The UI usually calculates totals itself from items. 
            // But let's sum them for the order header.
            if (ordersByDeliveryDay[deliveryDay].id === data.id) {
                // If we just initialized it with this data, these are already correct (except we initialized 0 above)
                // Let's set them now.
                currentConfig.totalValue = data.total_value;
                currentConfig.totalItems = data.total_items;
            } else {
                // Merging a second order (e.g. Breakfast adding to Lunch)
                // We shouldn't blindly sum if the UI recalculates, but DB validity matters.
                // Let's add them.
                currentConfig.totalValue = (currentConfig.totalValue || 0) + (data.total_value || 0);
                currentConfig.totalItems = (currentConfig.totalItems || 0) + (data.total_items || 0);
            }

            // Extract items/vendors for this specific order row
            let extractedVendorSelections: any[] = [];
            let extractedItems: any = {}; // For boxes
            let extractedItemPrices: any = {}; // For boxes

            if (data.service_type === 'Food') {
                const vendorSelections = db.upcomingOrderVendorSelections.filter(vs => vs.upcoming_order_id === data.id);
                if (vendorSelections.length > 0) {
                    for (const vs of vendorSelections) {
                        const items = db.upcomingOrderItems.filter(item => item.vendor_selection_id === vs.id);
                        const itemsMap: any = {};
                        for (const item of items) {
                            itemsMap[item.menu_item_id] = item.quantity;
                        }
                        extractedVendorSelections.push({
                            vendorId: vs.vendor_id,
                            items: itemsMap
                        });
                    }
                }
            } else if (data.service_type === 'Boxes') {
                const boxSelection = db.upcomingOrderBoxSelections.find(bs => bs.upcoming_order_id === data.id);
                if (boxSelection) {
                    // For boxes, we usually just have one main order. 
                    // But if we had "Breakfast Box" vs "Lunch Box" (unlikely feature currently), we'd handle it.
                    // Assuming Boxes are always 'Lunch'/'Main'.
                    if (mealType === 'Lunch') {
                        currentConfig.vendorId = boxSelection.vendor_id;
                        currentConfig.boxTypeId = boxSelection.box_type_id;
                        currentConfig.boxQuantity = boxSelection.quantity;
                    }

                    const itemsRaw = boxSelection.items || {};
                    for (const [itemId, value] of Object.entries(itemsRaw)) {
                        if (typeof value === 'number') {
                            extractedItems[itemId] = value;
                        } else if (value && typeof value === 'object' && 'quantity' in value) {
                            extractedItems[itemId] = (value as any).quantity;
                            if ('price' in value && (value as any).price !== undefined && (value as any).price !== null) {
                                extractedItemPrices[itemId] = (value as any).price;
                            }
                        }
                    }
                }
            } else if (data.service_type === 'Meal') {
                // Handle 'Meal' service type (Breakfast, Dinner)
                const vendorSelections = db.upcomingOrderVendorSelections.filter(vs => vs.upcoming_order_id === data.id);

                let mealVendorId = null;
                let mealItems: any = {};

                if (vendorSelections.length > 0) {
                    const vs = vendorSelections[0]; // Assuming single vendor per meal
                    mealVendorId = vs.vendor_id;

                    const items = db.upcomingOrderItems.filter(item => item.vendor_selection_id === vs.id);

                    for (const item of items) {
                        const itemId = item.meal_item_id || item.menu_item_id;

                        if (itemId) {
                            mealItems[itemId] = item.quantity;
                        } else {
                            console.warn(`[getUpcomingOrderForClientLocal] Item has no ID!`, item);
                        }
                    }
                } else {
                    console.warn(`[getUpcomingOrderForClientLocal] Meal order ${data.id} has NO vendor selections. Items will be empty.`);
                }

                // Store as meal selection
                currentConfig.mealSelections[mealType] = {
                    vendorId: mealVendorId,
                    items: mealItems
                };
            }

            // Now merge into the main config based on mealType
            if (mealType === 'Lunch') {
                // This is the MAIN order selections
                if (data.service_type === 'Food') {
                    currentConfig.vendorSelections = extractedVendorSelections;
                } else if (data.service_type === 'Boxes') {
                    currentConfig.items = extractedItems;
                    if (Object.keys(extractedItemPrices).length > 0) {
                        currentConfig.itemPrices = extractedItemPrices;
                    }
                }
                // Update main ID to match the Lunch ID (preferred reference)
                currentConfig.id = data.id;
            } else {
                // This is a MEAL selection (Breakfast, Dinner)
                // If it was already handled by the 'Meal' service type block above,
                // do not overwrite it with potentially empty extractedVendorSelections.
                if (data.service_type !== 'Meal') {
                    let mealVendorId = null;
                    let mealItems = {};

                    if (extractedVendorSelections.length > 0) {
                        mealVendorId = extractedVendorSelections[0].vendorId;
                        mealItems = extractedVendorSelections[0].items;
                    }

                    currentConfig.mealSelections[mealType] = {
                        vendorId: mealVendorId,
                        items: mealItems
                    };
                }
            }
        }

        // Post-processing: If we used a Meal ID as the main ID but we have a Food order now, ensure main ID is Food order's ID?
        // Actually, the loop logic sets ID only on first creation.
        // It might be better to do a second pass or check priorities.
        // But for now, let's assume it works or the order matters (fetched from DB sorted by created_at DESC).
        // If Food order is created first, it might be later in list if sorted by created_at DESC?
        // Sort is `new Date(b.created_at) - new Date(a.created_at)`. So newest first.
        // If I create Breakfast now, it's newest.
        // So `ordersByDeliveryDay` will use Breakfast ID.
        // Is this a problem?
        // `syncCurrentOrderToUpcoming` uses `order.id`? No, it looks at `orderConfig`.
        // If the ID changes, React key might change.
        // Let's rely on the fact that `sync` logic often clears and recreates.
        // If we strictly want Lunch ID, we'd need to prioritize it.
        // For now, let's leave as is.

        // If only one delivery day, return it directly for backward compatibility
        const deliveryDays = Object.keys(ordersByDeliveryDay);
        if (deliveryDays.length === 1 && deliveryDays[0] === 'default') {
            return ordersByDeliveryDay['default'];
        }

        return ordersByDeliveryDay;
    } catch (error) {
        console.error('Error in getUpcomingOrderForClientLocal:', error);
        return null;
    }
}

