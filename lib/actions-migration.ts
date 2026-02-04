'use server';

import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { ClientProfile } from './types';
import { syncCurrentOrderToUpcoming, getVendors } from './actions';
import { revalidatePath } from 'next/cache';

/** Merged order config shape (internal); after stripToSchemaConforming it matches UPCOMING_ORDER_SCHEMA.md exactly. */
export type MigrationPreviewOrder = {
    serviceType: string;
    caseId?: string;
    vendorSelections?: { vendorId: string; items: Record<string, number>; itemNotes?: Record<string, string> }[];
    deliveryDayOrders?: { [day: string]: { vendorSelections: { vendorId: string; items: Record<string, number>; itemNotes?: Record<string, string> }[] } };
    mealSelections?: { [mealType: string]: { vendorId?: string | null; items: Record<string, number>; itemNotes?: Record<string, string> } };
    boxOrders?: Array<{ id?: string; boxTypeId?: string; vendorId?: string; quantity?: number; items?: Record<string, number>; itemNotes?: Record<string, string>; itemPrices?: Record<string, number> }>;
    vendorId?: string;
    boxTypeId?: string;
    boxQuantity?: number;
    items?: Record<string, number>;
    itemPrices?: Record<string, number>;
    custom_name?: string;
    custom_price?: string | number;
    deliveryDay?: string;
    notes?: string;
};

/** Schema-conforming payload per UPCOMING_ORDER_SCHEMA.md — only allowed fields per serviceType. */
export type SchemaConformingOrder = Record<string, unknown>;

/**
 * Strip to exact schema per UPCOMING_ORDER_SCHEMA.md. Only allowed fields for each serviceType are kept.
 */
function stripToSchemaConforming(order: MigrationPreviewOrder): SchemaConformingOrder {
    const st = order.serviceType;
    if (st === 'Boxes') {
        const out: SchemaConformingOrder = { serviceType: 'Boxes' };
        if (order.caseId != null && order.caseId !== '') out.caseId = order.caseId;
        if (order.notes != null && order.notes !== '') out.notes = order.notes;
        if (order.boxOrders && order.boxOrders.length > 0) {
            out.boxOrders = order.boxOrders.map(bo => {
                const b: Record<string, unknown> = {};
                if (bo.boxTypeId) b.boxTypeId = bo.boxTypeId;
                if (bo.vendorId) b.vendorId = bo.vendorId;
                if (bo.quantity != null) b.quantity = bo.quantity;
                if (bo.items && Object.keys(bo.items).length > 0) b.items = bo.items;
                if (bo.itemNotes && Object.keys(bo.itemNotes).length > 0) b.itemNotes = bo.itemNotes;
                return b;
            });
        }
        return out;
    }
    if (st === 'Custom') {
        const out: SchemaConformingOrder = { serviceType: 'Custom' };
        if (order.caseId != null && order.caseId !== '') out.caseId = order.caseId;
        if (order.custom_name != null && order.custom_name !== '') out.custom_name = order.custom_name;
        if (order.custom_price != null) out.custom_price = order.custom_price;
        if (order.vendorId) out.vendorId = order.vendorId;
        if (order.deliveryDay) out.deliveryDay = order.deliveryDay;
        if (order.notes != null && order.notes !== '') out.notes = order.notes;
        return out;
    }
    // Food or Meal
    const out: SchemaConformingOrder = { serviceType: st };
    if (order.caseId != null && order.caseId !== '') out.caseId = order.caseId;
    if (order.notes != null && order.notes !== '') out.notes = order.notes;
    const stripVs = (vs: { vendorId: string; items: Record<string, number>; itemNotes?: Record<string, string> }) => {
        const v: Record<string, unknown> = { vendorId: vs.vendorId, items: vs.items || {} };
        if (vs.itemNotes && Object.keys(vs.itemNotes).length > 0) v.itemNotes = vs.itemNotes;
        return v;
    };
    if (order.vendorSelections && order.vendorSelections.length > 0) {
        (out as any).vendorSelections = order.vendorSelections.map(stripVs);
    }
    if (order.deliveryDayOrders && Object.keys(order.deliveryDayOrders).length > 0) {
        const ddo: Record<string, unknown> = {};
        for (const [day, dayOrder] of Object.entries(order.deliveryDayOrders)) {
            if (dayOrder?.vendorSelections?.length) {
                ddo[day] = { vendorSelections: dayOrder.vendorSelections.map(stripVs) };
            }
        }
        if (Object.keys(ddo).length > 0) out.deliveryDayOrders = ddo;
    }
    if (order.mealSelections && Object.keys(order.mealSelections).length > 0) {
        const ms: Record<string, unknown> = {};
        for (const [mealType, m] of Object.entries(order.mealSelections)) {
            if (m) {
                const hasItems = m.items && Object.keys(m.items).length > 0;
                const hasVendor = !!m.vendorId;
                const hasNotes = m.itemNotes && Object.keys(m.itemNotes || {}).length > 0;
                if (!hasItems && !hasVendor && !hasNotes) continue; // skip empty meal type
                const me: Record<string, unknown> = { items: m.items || {} };
                if (m.vendorId) me.vendorId = m.vendorId;
                if (hasNotes) me.itemNotes = m.itemNotes;
                ms[mealType] = me;
            }
        }
        if (Object.keys(ms).length > 0) out.mealSelections = ms;
    }
    return out;
}

export interface MigrationCandidate {
    clientId: string;
    clientName: string;
    serviceType: string;
    hasActiveOrder: boolean;
    hasFoodOrder: boolean;
    hasMealOrder: boolean;
    hasBoxOrders: boolean;
    hasCustomOrder: boolean;
    validationStatus: 'valid' | 'invalid_vendor' | 'invalid_day' | 'missing_vendor' | 'no_order_data' | 'unknown';
    validationMessage?: string;
    /** When validationStatus is invalid_day: bad day, vendor, and allowed days so user can fix inline */
    invalidDayFix?: {
        badDay: string;
        vendorId: string;
        vendorName: string;
        availableDays: string[];
    };
    /** Human-readable list of sources we read from (e.g. "Active order", "Client food orders") */
    sourcesRead: string[];
    orderDetails?: {
        source: string;
        description: string;
        details?: {
            caseId?: string;
            vendorName?: string;
            items?: string[];
            deliveryDays?: string[];
            boxType?: string;
            quantity?: number;
        };
        /** Preview of the exact JSON that will be written to clients.upcoming_order (schema-conforming per UPCOMING_ORDER_SCHEMA.md). */
        previewJson: SchemaConformingOrder | null;
        /** When validation is invalid_day: fix info for inline day correction */
        invalidDayFix?: {
            badDay: string;
            vendorId: string;
            vendorName: string;
            availableDays: string[];
        };
        raw?: any;
    };
}

/**
 * Build order config from upcoming_orders table (source of old orders to migrate into clients.upcoming_order).
 */
function buildFromUpcomingOrdersTable(
    upcomingOrders: any[],
    vendorSelections: any[],
    items: any[],
    boxSelections: any[],
    serviceType: string
): MigrationPreviewOrder | null {
    if (!upcomingOrders || upcomingOrders.length === 0) return null;
    const firstOrder = upcomingOrders[0];
    let merged: MigrationPreviewOrder = {
        serviceType: firstOrder.service_type || serviceType,
        caseId: firstOrder.case_id
    };
    const mapVs = (orderId: string) => {
        const orderVS = vendorSelections?.filter((vs: any) => vs.upcoming_order_id === orderId) || [];
        return orderVS.map((vs: any) => {
            const vsItems = items?.filter((i: any) => i.vendor_selection_id === vs.id) || [];
            const itemsMap: Record<string, number> = {};
            vsItems.forEach((item: any) => {
                const id = item.meal_item_id || item.menu_item_id;
                if (id) itemsMap[id] = item.quantity;
            });
            return { vendorId: vs.vendor_id, items: itemsMap };
        });
    };
    if (upcomingOrders.length === 1) {
        const order = upcomingOrders[0];
        if (order.service_type === 'Food' || order.service_type === 'Meal') {
            if (order.meal_type) {
                const vsList = mapVs(order.id);
                const mealType = order.meal_type || 'Lunch';
                const mealItems: Record<string, number> = {};
                vsList.forEach((vs: any) => Object.assign(mealItems, vs.items));
                merged.mealSelections = {
                    [mealType]: { vendorId: vsList[0]?.vendorId ?? null, items: mealItems }
                };
            } else if (order.delivery_day) {
                merged.deliveryDayOrders = {
                    [order.delivery_day]: { vendorSelections: mapVs(order.id) }
                };
            } else {
                merged.vendorSelections = mapVs(order.id);
            }
        } else if (order.service_type === 'Boxes') {
            const orderBoxSels = (boxSelections || []).filter((bs: any) => bs.upcoming_order_id === order.id);
            if (orderBoxSels.length > 0) {
                merged.boxOrders = orderBoxSels.map((bs: any) => ({
                    boxTypeId: bs.box_type_id,
                    vendorId: bs.vendor_id,
                    quantity: bs.quantity ?? 1,
                    items: bs.items || {},
                    itemNotes: bs.item_notes || {}
                }));
            }
        }
    } else {
        // Multiple orders: separate Food (delivery_day) from Meal (meal_type) — both can coexist per schema
        const deliveryDayOrders: Record<string, { vendorSelections: any[] }> = {};
        const mealSelections: Record<string, { vendorId: string | null; items: Record<string, number> }> = {};
        for (const order of upcomingOrders) {
            if (order.meal_type) {
                const vsList = mapVs(order.id);
                const mealType = order.meal_type || 'Lunch';
                const mealItems: Record<string, number> = {};
                vsList.forEach((vs: any) => Object.assign(mealItems, vs.items));
                mealSelections[mealType] = { vendorId: vsList[0]?.vendorId ?? null, items: mealItems };
            } else {
                const day = order.delivery_day || 'default';
                deliveryDayOrders[day] = { vendorSelections: mapVs(order.id) };
            }
        }
        if (Object.keys(deliveryDayOrders).length > 0) merged.deliveryDayOrders = deliveryDayOrders;
        if (Object.keys(mealSelections).length > 0) merged.mealSelections = mealSelections;
    }
    const hasContent =
        (merged.deliveryDayOrders && Object.keys(merged.deliveryDayOrders).length > 0) ||
        (merged.mealSelections && Object.keys(merged.mealSelections).length > 0) ||
        (merged.boxOrders && merged.boxOrders.length > 0) ||
        (merged.vendorSelections && merged.vendorSelections.length > 0);
    return hasContent ? merged : null;
}

/**
 * Build the single merged order config from all legacy sources for a client.
 * Sources: upcoming_orders table, active_order, client_food_orders, client_meal_orders, client_box_orders, custom.
 * Destination: clients.upcoming_order column.
 */
function buildMergedOrderConfig(rawClient: any, fromUpcomingTable?: MigrationPreviewOrder | null): MigrationPreviewOrder | null {
    const activeOrder = rawClient.active_order;
    const foodOrder = rawClient.client_food_orders?.[0];
    const mealOrder = rawClient.client_meal_orders?.[0];
    const boxOrders = (rawClient.client_box_orders || []) as any[];

    const serviceType = rawClient.service_type;

    // Start from upcoming_orders table (source of old orders) or active_order, then overlay other tables
    const baseFromUpcoming = fromUpcomingTable && (
        fromUpcomingTable.deliveryDayOrders || fromUpcomingTable.mealSelections || fromUpcomingTable.boxOrders || fromUpcomingTable.vendorSelections
    );
    let merged: MigrationPreviewOrder = baseFromUpcoming
        ? { ...fromUpcomingTable, serviceType: fromUpcomingTable!.serviceType || serviceType }
        : activeOrder && typeof activeOrder === 'object'
            ? {
                serviceType: activeOrder.serviceType || serviceType,
                caseId: activeOrder.caseId,
                vendorSelections: activeOrder.vendorSelections,
                deliveryDayOrders: activeOrder.deliveryDayOrders,
                mealSelections: activeOrder.mealSelections,
                boxOrders: activeOrder.boxOrders,
                vendorId: activeOrder.vendorId,
                boxTypeId: activeOrder.boxTypeId,
                boxQuantity: activeOrder.boxQuantity,
                items: activeOrder.items,
                itemPrices: activeOrder.itemPrices,
                custom_name: activeOrder.custom_name,
                custom_price: activeOrder.custom_price,
                deliveryDay: activeOrder.deliveryDay,
                notes: activeOrder.notes
            }
            : { serviceType };
    // Overlay active_order when we started from upcoming_orders table
    if (baseFromUpcoming && activeOrder && typeof activeOrder === 'object') {
        if (activeOrder.caseId) merged.caseId = merged.caseId ?? activeOrder.caseId;
        if (activeOrder.deliveryDayOrders) merged.deliveryDayOrders = activeOrder.deliveryDayOrders;
        if (activeOrder.mealSelections) merged.mealSelections = activeOrder.mealSelections;
        if (activeOrder.boxOrders) merged.boxOrders = activeOrder.boxOrders;
        if (activeOrder.vendorSelections) merged.vendorSelections = activeOrder.vendorSelections;
        if (activeOrder.custom_name != null || activeOrder.custom_price != null) {
            merged.custom_name = activeOrder.custom_name;
            merged.custom_price = activeOrder.custom_price;
            merged.deliveryDay = activeOrder.deliveryDay;
            merged.vendorId = activeOrder.vendorId;
        }
    }

    // Overlay client_food_orders (Food can also have meals; we'll add mealSelections below for Food clients)
    if (foodOrder) {
        if (foodOrder.delivery_day_orders && Object.keys(foodOrder.delivery_day_orders).length > 0) {
            merged.serviceType = 'Food';
            merged.deliveryDayOrders = foodOrder.delivery_day_orders as MigrationPreviewOrder['deliveryDayOrders'];
        }
        if (foodOrder.case_id) merged.caseId = merged.caseId ?? foodOrder.case_id;
        if (foodOrder.case_id && !merged.deliveryDayOrders) merged.serviceType = 'Food'; // Case ID only from food table
    }

    // Overlay client_meal_orders. Food clients can have meals too — keep serviceType Food and add mealSelections.
    if (mealOrder) {
        if (mealOrder.meal_selections && Object.keys(mealOrder.meal_selections).length > 0) {
            merged.mealSelections = mealOrder.meal_selections as MigrationPreviewOrder['mealSelections'];
            if (serviceType === 'Meal') merged.serviceType = 'Meal';
            else if (serviceType === 'Food') merged.serviceType = 'Food'; // Food + meals: keep Food, add mealSelections
        }
        if (mealOrder.case_id) merged.caseId = merged.caseId ?? mealOrder.case_id;
        if (mealOrder.case_id && !merged.mealSelections) merged.serviceType = 'Meal'; // Case ID only from meal table
    }

    // Overlay client_box_orders
    if (boxOrders.length > 0) {
        merged.serviceType = 'Boxes';
        merged.boxOrders = boxOrders.map((b: any) => ({
            id: b.id,
            boxTypeId: b.box_type_id,
            vendorId: b.vendor_id,
            quantity: b.quantity,
            items: b.items || {},
            itemNotes: (b.item_notes || b.itemNotes || {}) as Record<string, string>
        }));
        if (boxOrders[0].case_id) merged.caseId = boxOrders[0].case_id;
    } else if (serviceType === 'Boxes' && merged.caseId) {
        merged.serviceType = 'Boxes'; // Case ID only, boxes type
    }

    // Custom: only in active_order
    if (serviceType === 'Custom' && activeOrder && (activeOrder.custom_name || activeOrder.custom_price != null)) {
        merged.serviceType = 'Custom';
        merged.caseId = merged.caseId ?? activeOrder.caseId;
        merged.custom_name = activeOrder.custom_name;
        merged.custom_price = activeOrder.custom_price;
        merged.deliveryDay = activeOrder.deliveryDay;
        merged.vendorId = activeOrder.vendorId;
    }

    const hasAnyContent =
        (merged.deliveryDayOrders && Object.keys(merged.deliveryDayOrders).length > 0) ||
        (merged.mealSelections && Object.keys(merged.mealSelections).length > 0) ||
        (merged.boxOrders && merged.boxOrders.length > 0) ||
        (merged.custom_name != null || merged.custom_price != null) ||
        (merged.vendorId && merged.items && Object.keys(merged.items).length > 0) ||
        (merged.boxTypeId != null || merged.boxQuantity != null) ||
        (merged.caseId != null && merged.serviceType); // Case ID + service type only: still valid to migrate

    return hasAnyContent ? merged : null;
}

// Same pagination approach as getRegularClients (range-based, 1000 per page) — proven to work for 700+ clients.
const PAGE_SIZE = 1000;

/** Fetch all client rows using range pagination (same as getRegularClients). */
async function fetchAllClients(
    supabaseAdmin: ReturnType<typeof supabase>,
    clientSelect: string
): Promise<Record<string, any>[]> {
    const out: Record<string, any>[] = [];
    let page = 0;
    while (true) {
        const { data, error } = await supabaseAdmin
            .from('clients')
            .select(clientSelect)
            .is('parent_client_id', null)
            .order('id', { ascending: true })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        if (rows.length === 0) break;
        out.push(...rows);
        if (rows.length < PAGE_SIZE) break;
        page++;
    }
    return out;
}

/** Fetch all client_box_orders for given client IDs (guarantees all rows, avoids embed limits). */
async function fetchClientBoxOrders(
    supabaseAdmin: ReturnType<typeof supabase>,
    clientIds: string[]
): Promise<Map<string, any[]>> {
    const result = new Map<string, any[]>();
    if (clientIds.length === 0) return result;
    const { data: rows } = await supabaseAdmin
        .from('client_box_orders')
        .select('*')
        .in('client_id', clientIds);
    if (!rows) return result;
    for (const cid of clientIds) {
        const clientBoxes = rows.filter((r: any) => r.client_id === cid);
        if (clientBoxes.length > 0) result.set(cid, clientBoxes);
    }
    return result;
}

/** Fetch all upcoming_orders for given client IDs (source of old orders to migrate into clients.upcoming_order). */
async function fetchUpcomingOrdersByClients(
    supabaseAdmin: ReturnType<typeof supabase>,
    clientIds: string[]
): Promise<Map<string, { orders: any[]; vendorSelections: any[]; items: any[]; boxSelections: any[] }>> {
    const result = new Map<string, { orders: any[]; vendorSelections: any[]; items: any[]; boxSelections: any[] }>();
    if (clientIds.length === 0) return result;
    const { data: orders } = await supabaseAdmin
        .from('upcoming_orders')
        .select('*')
        .in('client_id', clientIds)
        .eq('status', 'scheduled');
    if (!orders || orders.length === 0) return result;
    const orderIds = orders.map(o => o.id);
    const [vsData, itemsData, boxData] = await Promise.all([
        supabaseAdmin.from('upcoming_order_vendor_selections').select('*').in('upcoming_order_id', orderIds),
        supabaseAdmin.from('upcoming_order_items').select('*').in('upcoming_order_id', orderIds),
        supabaseAdmin.from('upcoming_order_box_selections').select('*').in('upcoming_order_id', orderIds)
    ]);
    const vendorSelections = vsData.data ?? [];
    const items = itemsData.data ?? [];
    const boxSelections = boxData.data ?? [];
    for (const cid of clientIds) {
        const clientOrders = orders.filter(o => o.client_id === cid);
        if (clientOrders.length > 0) {
            result.set(cid, { orders: clientOrders, vendorSelections, items, boxSelections });
        }
    }
    return result;
}

export async function getClientsWithoutUpcomingOrders(): Promise<MigrationCandidate[]> {
    // Use service role to bypass RLS — migration needs to see all primary clients (700+), not just those visible per user
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseAdmin = serviceRoleKey
        ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, { auth: { persistSession: false } })
        : supabase;

    const clientSelect = `
        id, 
        full_name, 
        service_type, 
        active_order,
        upcoming_order,
        client_food_orders(id, delivery_day_orders, case_id),
        client_meal_orders(id, meal_selections, case_id),
        client_box_orders(id, box_type_id, quantity, vendor_id, items, item_notes, case_id)
    `;

    // 1. Get ALL primary clients (range pagination, same as getRegularClients)
    const clients = await fetchAllClients(supabaseAdmin, clientSelect);

    // 2. Fetch upcoming_orders and client_box_orders (separate queries guarantee all rows)
    const clientIds = clients.map(c => c.id);
    const [upcomingByClient, boxOrdersByClient] = await Promise.all([
        fetchUpcomingOrdersByClients(supabaseAdmin, clientIds),
        fetchClientBoxOrders(supabaseAdmin, clientIds)
    ]);

    // 3. Fetch auxiliary data for names
    const vendors = await getVendors();
    const { data: boxTypes } = await supabaseAdmin.from('box_types').select('id, name');

    // Helper to get vendor name
    const getVendorName = (id: string) => vendors.find(v => v.id === id)?.name || `Unknown Vendor (${id})`;
    const getBoxTypeName = (id: string) => boxTypes?.find(b => b.id === id)?.name || `Unknown Box Type (${id})`;

    // 4. Filter and Map
    const candidates: MigrationCandidate[] = [];

    for (const client of clients) {
        // Skip if clients.upcoming_order column is already filled (the destination — only 2 clients have this)
        const existingUpcoming = client.upcoming_order;
        const hasNewColumnFilled = existingUpcoming != null &&
            typeof existingUpcoming === 'object' &&
            Object.keys(existingUpcoming).length > 0 &&
            (existingUpcoming.serviceType || existingUpcoming.caseId || existingUpcoming.boxOrders || existingUpcoming.deliveryDayOrders || existingUpcoming.mealSelections);
        if (hasNewColumnFilled) continue;

        // Build order config from upcoming_orders table (source of old orders)
        const upcomingData = upcomingByClient.get(client.id);
        const fromUpcomingTable = upcomingData
            ? buildFromUpcomingOrdersTable(
                upcomingData.orders,
                upcomingData.vendorSelections,
                upcomingData.items,
                upcomingData.boxSelections,
                client.service_type
            )
            : null;

        // Check every source where we might have order data
        const hasUpcomingTable = !!fromUpcomingTable;
        const hasActiveOrder = !!client.active_order && typeof client.active_order === 'object' && Object.keys(client.active_order).length > 0;
        const hasFoodOrder = client.client_food_orders && client.client_food_orders.length > 0;
        const hasMealOrder = client.client_meal_orders && client.client_meal_orders.length > 0;
        const hasBoxOrders = client.client_box_orders && client.client_box_orders.length > 0;
        const hasCustomOrder = client.service_type === 'Custom' && hasActiveOrder && (client.active_order?.custom_name != null || client.active_order?.custom_price != null);

        // Use explicitly fetched client_box_orders (all rows) when available
        const clientWithBoxes = {
            ...client,
            client_box_orders: boxOrdersByClient.get(client.id) ?? client.client_box_orders ?? []
        };
        const previewJson = buildMergedOrderConfig(clientWithBoxes, fromUpcomingTable);

        const sourcesRead: string[] = [];
        if (hasUpcomingTable) sourcesRead.push('Upcoming orders table');
        if (hasActiveOrder) sourcesRead.push('Active order (clients.active_order)');
        if (hasFoodOrder) sourcesRead.push('Food orders (client_food_orders)');
        if (hasMealOrder) sourcesRead.push('Meal orders (client_meal_orders)');
        if (hasBoxOrders) sourcesRead.push('Box orders (client_box_orders)');
        if (hasCustomOrder) sourcesRead.push('Custom order (active_order)');

        // Basic Validation Logic
        let status: MigrationCandidate['validationStatus'] = 'valid';
        let message = 'Ready to migrate';
        let         orderDetails: MigrationCandidate['orderDetails'] = {
            source: sourcesRead.join('; ') || 'Unknown',
            description: 'No details found',
            details: {},
            previewJson: previewJson ? stripToSchemaConforming(previewJson) : null
        };

        const serviceType = client.service_type;

        // --- ENRICH DISPLAY (description, details) FROM MERGED PREVIEW ---
        if (previewJson) {
            if (previewJson.deliveryDayOrders && Object.keys(previewJson.deliveryDayOrders).length > 0) {
                const days = Object.keys(previewJson.deliveryDayOrders);
                const vendorNames = new Set<string>();
                for (const day of days) {
                    const dayOrder = previewJson.deliveryDayOrders[day];
                    if (dayOrder?.vendorSelections) {
                        for (const sel of dayOrder.vendorSelections) {
                            if (sel.vendorId) vendorNames.add(getVendorName(sel.vendorId));
                        }
                    }
                }
                const mealTypes = previewJson.mealSelections ? Object.keys(previewJson.mealSelections) : [];
                orderDetails.description = mealTypes.length > 0
                    ? `Days: ${days.join(', ')}; Meals: ${mealTypes.join(', ')}`
                    : `Days: ${days.join(', ')}`;
                orderDetails.details = {
                    caseId: previewJson.caseId,
                    deliveryDays: days,
                    vendorName: Array.from(vendorNames).join(', '),
                    items: mealTypes.length > 0 ? mealTypes : []
                };
            } else if (previewJson.mealSelections && Object.keys(previewJson.mealSelections).length > 0) {
                const meals = Object.keys(previewJson.mealSelections);
                orderDetails.description = `Meals: ${meals.join(', ')}`;
                orderDetails.details = { caseId: previewJson.caseId, items: meals };
            } else if (previewJson.boxOrders && previewJson.boxOrders.length > 0) {
                const first = previewJson.boxOrders[0];
                const typeName = first.boxTypeId ? getBoxTypeName(first.boxTypeId) : '';
                const vName = first.vendorId ? getVendorName(first.vendorId) : '';
                orderDetails.description = `${previewJson.boxOrders.length} Box subscription(s)`;
                orderDetails.details = {
                    caseId: previewJson.caseId,
                    vendorName: vName,
                    boxType: typeName,
                    quantity: first.quantity
                };
            } else if (previewJson.custom_name != null || previewJson.custom_price != null) {
                orderDetails.description = `Custom: ${previewJson.custom_name || '—'} / ${previewJson.custom_price ?? '—'}`;
                orderDetails.details = { caseId: previewJson.caseId, deliveryDays: previewJson.deliveryDay ? [previewJson.deliveryDay] : undefined };
            } else if (previewJson.caseId && previewJson.serviceType) {
                orderDetails.description = `${previewJson.serviceType}: Case ID only`;
                orderDetails.details = { caseId: previewJson.caseId };
            } else {
                orderDetails.description = 'Order data merged from sources above';
                orderDetails.details = { caseId: previewJson.caseId };
            }
        }
        orderDetails.raw = {
            active_order: client.active_order,
            client_food_orders: client.client_food_orders,
            client_meal_orders: client.client_meal_orders,
            client_box_orders: client.client_box_orders
        };

        // --- VALIDATION ---
        if (!previewJson) {
            status = 'no_order_data';
            message = 'No order content after merging sources';
        }
        // Validation for Boxes
        else if (serviceType === 'Boxes') {
            // Case ID + serviceType only is valid to migrate
            if (previewJson.caseId && previewJson.serviceType) {
                // Valid — allow migration with just caseId
            } else if (!hasBoxOrders && (!client.active_order || !client.active_order.boxOrders)) {
                if (client.active_order && (client.active_order.boxTypeId || client.active_order.vendorId)) {
                    if (client.active_order.vendorId) {
                        const v = vendors.find(v => v.id === client.active_order.vendorId);
                        if (!v) {
                            status = 'invalid_vendor';
                            message = `Legacy: Vendor not found`;
                        }
                    }
                } else {
                    status = 'no_order_data';
                    message = 'Service is Boxes but no box orders found';
                }
            }
        }
        else if (serviceType === 'Meal') {
            if (!hasMealOrder && !hasActiveOrder) {
                status = 'no_order_data';
                message = 'Service is Meal but no order data found';
            }
        }
        else if (serviceType === 'Food' && previewJson.deliveryDayOrders) {
            let invalidDayFix: MigrationCandidate['invalidDayFix'];
            for (const [day, dayOrder] of Object.entries(previewJson.deliveryDayOrders)) {
                const vendorSelections = (dayOrder as any).vendorSelections || [];
                for (const sel of vendorSelections) {
                    if (sel.vendorId) {
                        const v = vendors.find(v => v.id === sel.vendorId);
                        if (!v) {
                            status = 'invalid_vendor';
                            message = `Vendor ${sel.vendorId} not found`;
                            break;
                        }
                        const deliveryDays = (v as any).delivery_days ?? v.deliveryDays ?? [];
                        if (deliveryDays.length > 0 && !deliveryDays.includes(day)) {
                            status = 'invalid_day';
                            message = `Vendor ${v.name} does not deliver on ${day}`;
                            invalidDayFix = {
                                badDay: day,
                                vendorId: v.id,
                                vendorName: v.name,
                                availableDays: Array.isArray(deliveryDays) ? [...deliveryDays] : []
                            };
                            break;
                        }
                    }
                }
                if (status !== 'valid') {
                    if (invalidDayFix) orderDetails.invalidDayFix = invalidDayFix;
                    break;
                }
            }
        } else if (serviceType === 'Food') {
            const hasDeliveryDays = previewJson.deliveryDayOrders && Object.keys(previewJson.deliveryDayOrders).length > 0;
            const hasVendorSelections = previewJson.vendorSelections && previewJson.vendorSelections.length > 0;
            const hasNonEmptyMeals = previewJson.mealSelections && Object.entries(previewJson.mealSelections).some(([, m]) => {
                if (!m) return false;
                return (m.items && Object.keys(m.items).length > 0) || !!m.vendorId || (m.itemNotes && Object.keys(m.itemNotes || {}).length > 0);
            });
            const hasVendorData = hasDeliveryDays || hasVendorSelections || hasNonEmptyMeals;
            if (previewJson.caseId && previewJson.serviceType && !hasVendorData) {
                // Case ID only: valid to migrate, no vendor required
            } else if (previewJson.caseId && previewJson.serviceType && hasVendorData) {
                // Has delivery days, vendor selections, or meal selections: valid. Meals do not require vendor in active_order; vendor can be in mealSelections or added later.
            } else {
                const ao = client.active_order;
                if (ao?.vendorId) {
                    const v = vendors.find(v => v.id === ao.vendorId);
                    if (!v) { status = 'invalid_vendor'; message = 'ActiveOrder Vendor not found'; }
                } else if (ao?.vendorSelections?.length) {
                    const v = vendors.find(v => v.id === ao.vendorSelections[0].vendorId);
                    if (!v) { status = 'invalid_vendor'; message = 'Vendor not found'; }
                } else {
                    status = 'missing_vendor';
                    message = 'No vendor selected in active order';
                }
            }
        }
        // Validation for Custom: vendor must deliver on selected delivery day
        else if (serviceType === 'Custom' && previewJson?.vendorId && previewJson?.deliveryDay) {
            const v = vendors.find(v => v.id === previewJson.vendorId);
            if (!v) {
                status = 'invalid_vendor';
                message = 'Custom order vendor not found';
            } else {
                const deliveryDays = (v as any).delivery_days ?? v.deliveryDays ?? [];
                if (deliveryDays.length > 0 && !deliveryDays.includes(previewJson.deliveryDay)) {
                    status = 'invalid_day';
                    message = `Vendor ${v.name} does not deliver on ${previewJson.deliveryDay}`;
                    orderDetails.invalidDayFix = {
                        badDay: previewJson.deliveryDay,
                        vendorId: v.id,
                        vendorName: v.name,
                        availableDays: Array.isArray(deliveryDays) ? [...deliveryDays] : []
                    };
                }
            }
        }

        candidates.push({
            clientId: client.id,
            clientName: client.full_name,
            serviceType: client.service_type,
            hasActiveOrder,
            hasFoodOrder,
            hasMealOrder,
            hasBoxOrders,
            hasCustomOrder: !!hasCustomOrder,
            validationStatus: status,
            validationMessage: message,
            invalidDayFix: orderDetails.invalidDayFix,
            sourcesRead,
            orderDetails
        });
    }

    return candidates;
}

/**
 * Migrate a client to upcoming orders. Optionally fix an invalid delivery day by replacing
 * badDay with newDay in deliveryDayOrders (e.g. "Wednesday" → "Monday" for a vendor that only delivers Monday).
 */
export async function migrateClientToUpcoming(
    clientId: string,
    options?: { replaceDay?: { badDay: string; newDay: string } }
) {
    try {
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const sb = serviceRoleKey
            ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, { auth: { persistSession: false } })
            : supabase;
        const { data: rawClient, error } = await sb
            .from('clients')
            .select(`
                *,
                client_food_orders(*),
                client_meal_orders(*),
                client_box_orders(*)
            `)
            .eq('id', clientId)
            .single();

        if (error || !rawClient) throw new Error(`Client not found: ${error?.message}`);

        const [upcomingData, boxOrdersList] = await Promise.all([
            fetchUpcomingOrdersByClients(sb, [clientId]).then(m => m.get(clientId)),
            fetchClientBoxOrders(sb, [clientId]).then(m => m.get(clientId) ?? [])
        ]);
        const rawClientWithBoxes = {
            ...rawClient,
            client_box_orders: boxOrdersList ?? rawClient.client_box_orders ?? []
        };
        const fromUpcomingTable = upcomingData
            ? buildFromUpcomingOrdersTable(
                upcomingData.orders,
                upcomingData.vendorSelections,
                upcomingData.items,
                upcomingData.boxSelections,
                rawClient.service_type
            )
            : null;

        let mergedOrder = buildMergedOrderConfig(rawClientWithBoxes, fromUpcomingTable);
        if (!mergedOrder) throw new Error('No order data to migrate after merging sources.');

        if (options?.replaceDay) {
            const { badDay, newDay } = options.replaceDay;
            if (mergedOrder.deliveryDayOrders) {
                const days = Object.keys(mergedOrder.deliveryDayOrders);
                if (days.includes(badDay)) {
                    const next: typeof mergedOrder.deliveryDayOrders = {};
                    for (const d of days) {
                        const key = d === badDay ? newDay : d;
                        if (!next[key]) next[key] = { vendorSelections: [] };
                        const existing = mergedOrder!.deliveryDayOrders![d];
                        if (existing?.vendorSelections) {
                            next[key].vendorSelections = [...(next[key].vendorSelections || []), ...existing.vendorSelections];
                        }
                    }
                    mergedOrder = { ...mergedOrder, deliveryDayOrders: next };
                }
            } else if (mergedOrder.deliveryDay === badDay) {
                // Custom orders use top-level deliveryDay
                mergedOrder = { ...mergedOrder, deliveryDay: newDay };
            }
        }

        const schemaPayload = stripToSchemaConforming(mergedOrder);
        const clientProfile: any = {
            id: rawClient.id,
            fullName: rawClient.full_name,
            email: rawClient.email,
            address: rawClient.address,
            phoneNumber: rawClient.phone_number,
            navigatorId: rawClient.navigator_id,
            statusId: rawClient.status_id,
            serviceType: rawClient.service_type,
            activeOrder: schemaPayload
        };

        await syncCurrentOrderToUpcoming(clientId, clientProfile);

        revalidatePath('/admin/migrate-upcoming');
        return { success: true };
    } catch (e: any) {
        console.error('Migration failed:', e);
        return { success: false, error: e.message };
    }
}
