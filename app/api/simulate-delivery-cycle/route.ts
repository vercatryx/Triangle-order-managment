import { getSession } from '@/lib/session';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentTime } from '@/lib/time';
// Imports removed to prevent RLS issues with anonymous client
// import { getMenuItems, getVendors... } from '@/lib/actions';
import {
    getDaysUntilDelivery,
    isWithinCutoff,
    DAY_NAME_TO_NUMBER,
    getNextDeliveryDateForDay
} from '@/lib/order-dates';
import { sendSchedulingReport } from '@/lib/email-report';
import { AppSettings, Vendor } from '@/lib/types';
import * as XLSX from 'xlsx';
import { getNextCreationId } from '@/lib/actions';
import { hasBlockingCleanupIssues, type BlockContext } from '@/lib/order-creation-block';

// Initialize Supabase Admin Client to bypass RLS
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
    // PUBLIC ACCESS ENABLED (Per User Request)
    console.log('[Unified Scheduling] Starting execution... (Public Trigger)');

    // --- 0. Setup Reporting ---
    const report = {
        totalCreated: 0,
        breakdown: { Food: 0, Meal: 0, Boxes: 0, Custom: 0 },
        unexpectedFailures: [] as { clientName: string, orderType: string, date: string, reason: string }[]
    };

    const clientStatusMap = new Map<string, {
        clientName: string,
        foodStatus: string,
        mealStatus: string,
        boxStatus: string,
        customStatus: string,
        summary: string,
        vendor: string,
        orderCreated: boolean,
        scheduledDeliveryDate: string | null,
        // Track orders created in this run
        ordersCreatedThisRun: Array<{ type: string, date: string, vendor: string, logic: string }>,
        // Track expected orders for this week
        expectedOrdersThisWeek: Array<{ type: string, day: string, vendor: string, cutoffDay: string }>
    }>();

    function setClientStatus(clientId: string, type: 'food' | 'meal' | 'box' | 'custom', status: string) {
        const entry = clientStatusMap.get(clientId);
        if (entry) {
            if (type === 'food') entry.foodStatus = status;
            else if (type === 'meal') entry.mealStatus = status;
            else if (type === 'box') entry.boxStatus = status;
            else if (type === 'custom') entry.customStatus = status;
        }
    }

    function appendClientSummary(clientId: string, text: string) {
        const entry = clientStatusMap.get(clientId);
        if (entry) {
            entry.summary = entry.summary ? `${entry.summary}; ${text}` : text;
        }
    }

    function logUnexpected(clientName: string, type: string, date: string, reason: string) {
        // Reduced log noise - only log full errors if needed really
        // console.error(`[Unexpected Failure] ${clientName} | ${type} | ${reason}`);
        report.unexpectedFailures.push({ clientName, orderType: type, date, reason });
    }

    try {
        // --- 1. Load Global Context (Optimized) ---
        const currentTime = await getCurrentTime();
        // Ensure we're working with the date correctly
        // The cookie stores the date as ISO string (UTC) when user selects a date in the modal
        // The cookie is now set with the date at midnight in the browser's local timezone, then converted to ISO (UTC)
        // When we read it back, we need to extract the UTC date components and interpret them correctly
        // Since the cookie was set with local midnight, the UTC time represents that same date in UTC
        // We'll use the UTC date components directly to avoid timezone conversion issues
        const year = currentTime.getUTCFullYear();
        const month = currentTime.getUTCMonth();
        const day = currentTime.getUTCDate();
        // However, we need to account for the fact that the cookie might have been set in a different timezone
        // So let's also check the EST representation to be safe
        const estFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const estParts = estFormatter.formatToParts(currentTime);
        const estYear = parseInt(estParts.find(p => p.type === 'year')!.value);
        const estMonth = parseInt(estParts.find(p => p.type === 'month')!.value) - 1; // 0-indexed
        const estDay = parseInt(estParts.find(p => p.type === 'day')!.value);

        // Use EST date components (this is what the user selected)
        // Create date at midnight in local timezone for date arithmetic
        const today = new Date(estYear, estMonth, estDay, 0, 0, 0, 0);

        // Fetch Reference Data (Optimized Selects)
        const [
            vendorsRes,
            statusesRes,
            menuItemsRes,
            mealItemsRes
        ] = await Promise.all([
            supabase.from('vendors').select('id, name, email, service_type, delivery_days, delivery_frequency, is_active, minimum_meals, cutoff_hours'),
            supabase.from('client_statuses').select('id, name, is_system_default, deliveries_allowed'),
            // Only fetch fields needed for pricing/validation
            supabase.from('menu_items').select('id, vendor_id, name, value, price_each, is_active, category_id, minimum_order, image_url, sort_order'),
            supabase.from('breakfast_items').select('id, category_id, name, quota_value, price_each, is_active, vendor_id, image_url, sort_order')
        ]);

        const allVendors = (vendorsRes.data || []).map((v: any) => ({
            id: v.id,
            name: v.name,
            email: v.email || null,
            serviceTypes: (v.service_type || '').split(',').map((s: string) => s.trim()).filter(Boolean),
            deliveryDays: v.delivery_days || [],
            allowsMultipleDeliveries: v.delivery_frequency === 'Multiple',
            isActive: v.is_active,
            minimumMeals: v.minimum_meals ?? 0,
            cutoffDays: v.cutoff_hours ?? 0
        }));

        const allStatuses = (statusesRes.data || []).map((s: any) => ({
            id: s.id,
            name: s.name,
            isSystemDefault: s.is_system_default,
            deliveriesAllowed: s.deliveries_allowed
        }));

        const allMenuItems = (menuItemsRes.data || []).map((i: any) => ({
            id: i.id,
            vendorId: i.vendor_id,
            name: i.name,
            value: i.value,
            priceEach: i.price_each ?? undefined,
            isActive: i.is_active,
            categoryId: i.category_id,
            minimumOrder: i.minimum_order ?? 0,
            imageUrl: i.image_url || null,
            itemType: 'menu'
        }));

        const allMealItems = (mealItemsRes.data || []).map((i: any) => ({
            id: i.id,
            categoryId: i.category_id,
            name: i.name,
            value: i.quota_value,
            quotaValue: i.quota_value,
            priceEach: i.price_each ?? undefined,
            isActive: i.is_active,
            vendorId: i.vendor_id,
            imageUrl: i.image_url || null,
            itemType: 'meal'
        }));

        const { data: settingsData } = await supabase.from('app_settings').select('*').single();
        const settings = settingsData as any;
        const reportEmail = settings?.report_email || 'admin@example.com';

        // Fetch box types for summary
        const { data: boxTypesRes } = await supabase.from('box_types').select('id, name');
        const allBoxTypes = (boxTypesRes || []).map((bt: any) => ({
            id: bt.id,
            name: bt.name
        }));

        // Optimized Maps for O(1) Lookup
        const statusMap = new Map(allStatuses.map(s => [s.id, s]));
        const vendorMap = new Map(allVendors.map(v => [v.id, v]));
        const menuItemMap = new Map(allMenuItems.map(i => [i.id, i]));
        const mealItemMap = new Map(allMealItems.map(i => [i.id, i]));
        const boxTypeMap = new Map(allBoxTypes.map(bt => [bt.id, bt.name]));

        // Block context: skip clients with inactive/deleted items or invalid vendors (fix on cleanup page first)
        const { data: itemCatData } = await supabase.from('item_categories').select('id, is_active');
        const { data: breakfastCatData } = await supabase.from('breakfast_categories').select('id, is_active');
        const activeItemCatIds = new Set((itemCatData || []).filter((r: any) => r.is_active === true).map((r: any) => r.id));
        const activeBreakfastCatIds = new Set((breakfastCatData || []).filter((r: any) => r.is_active === true).map((r: any) => r.id));
        const allMenuItemIds = new Set(allMenuItems.map((i: any) => i.id));
        const allBreakfastItemIds = new Set(allMealItems.map((i: any) => i.id));
        const activeMenuItemIds = new Set(
            allMenuItems.filter((i: any) => i.isActive === true && (i.categoryId == null || i.categoryId === '' || activeItemCatIds.size === 0 || activeItemCatIds.has(i.categoryId))).map((i: any) => i.id)
        );
        const activeBreakfastItemIds = new Set(
            allMealItems.filter((i: any) => i.isActive === true && (i.categoryId == null || i.categoryId === '' || activeBreakfastCatIds.size === 0 || activeBreakfastCatIds.has(i.categoryId))).map((i: any) => i.id)
        );
        const blockVendorMap = new Map<string, { is_active: boolean }>();
        for (const v of allVendors) {
            blockVendorMap.set(v.id, { is_active: !!v.isActive });
        }
        const blockCtx: BlockContext = { activeMenuItemIds, activeBreakfastItemIds, allMenuItemIds, allBreakfastItemIds, vendorMap: blockVendorMap };

        // Fetch Clients (Optimized Select) - Exclude dependents; include upcoming_order (single source of truth)
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('id, full_name, status_id, service_type, parent_client_id, upcoming_order')
            .is('parent_client_id', null); // Exclude dependents

        if (clientsError) throw new Error(`Failed to fetch clients: ${clientsError.message}`);
        const clientMap = new Map(clients.map(c => [c.id, c]));

        // Initialize clientStatusMap for Excel report with detailed reasons
        for (const client of clients) {
            const status = statusMap.get(client.status_id);
            const deliveriesAllowed = status?.deliveriesAllowed ?? false;
            const statusName = status?.name || 'Unknown Status';

            // Build detailed reason for deliveries not allowed
            const noDeliveryReason = !deliveriesAllowed
                ? `Status "${statusName}" does not allow deliveries`
                : null;

            // More descriptive initial statuses
            const getFoodStatus = () => {
                if (noDeliveryReason) return noDeliveryReason;
                if (client.service_type !== 'Food') return `Client type is ${client.service_type}, not Food`;
                return 'No upcoming food orders scheduled';
            };

            const getMealStatus = () => {
                if (noDeliveryReason) return noDeliveryReason;
                if (client.service_type !== 'Food' && client.service_type !== 'Meal') return `Client type is ${client.service_type}, not Meal`;
                return 'No upcoming meal orders scheduled';
            };

            const getBoxStatus = () => {
                if (noDeliveryReason) return noDeliveryReason;
                if (client.service_type !== 'Boxes') return `Client type is ${client.service_type}, not Boxes`;
                return 'No upcoming box orders scheduled';
            };

            const getCustomStatus = () => {
                if (noDeliveryReason) return noDeliveryReason;
                if (client.service_type !== 'Custom') return `Client type is ${client.service_type}, not Custom`;
                return 'No upcoming custom orders scheduled';
            };

            clientStatusMap.set(client.id, {
                clientName: client.full_name,
                foodStatus: getFoodStatus(),
                mealStatus: getMealStatus(),
                boxStatus: getBoxStatus(),
                customStatus: getCustomStatus(),
                summary: '',
                vendor: 'no vendor set',
                orderCreated: false,
                scheduledDeliveryDate: null,
                ordersCreatedThisRun: [],
                expectedOrdersThisWeek: []
            });
        }

        // Build summary from clients.upcoming_order (single source of truth). Skip clients with blocking cleanup issues.
        const foodOrdersForSummary = (clients || [])
            .filter((c: any) => c.service_type === 'Food' && c.upcoming_order?.deliveryDayOrders && !hasBlockingCleanupIssues(c.upcoming_order, blockCtx))
            .map((c: any) => ({
                client_id: c.id,
                delivery_day_orders: c.upcoming_order.deliveryDayOrders
            }));
        const mealOrdersForSummary = (clients || [])
            .filter((c: any) => (c.service_type === 'Food' || c.service_type === 'Meal') && c.upcoming_order?.mealSelections && !hasBlockingCleanupIssues(c.upcoming_order, blockCtx))
            .map((c: any) => ({
                client_id: c.id,
                meal_selections: c.upcoming_order.mealSelections
            }));
        const boxOrdersForSummary: { client_id: string; vendor_id?: string; box_type_id?: string; quantity: number; items: any }[] = [];
        for (const c of clients || []) {
            if (c.service_type !== 'Boxes' || !c.upcoming_order?.boxOrders?.length) continue;
            if (hasBlockingCleanupIssues(c.upcoming_order, blockCtx)) continue;
            for (const b of c.upcoming_order.boxOrders) {
                boxOrdersForSummary.push({
                    client_id: c.id,
                    vendor_id: b.vendorId,
                    box_type_id: b.boxTypeId,
                    quantity: b.quantity ?? 1,
                    items: b.items ?? {}
                });
            }
        }
        const customOrdersFromClients = (clients || [])
            .filter((c: any) => c.upcoming_order?.serviceType === 'Custom' && !hasBlockingCleanupIssues(c.upcoming_order, blockCtx))
            .map((c: any) => ({
                client_id: c.id,
                delivery_day: c.upcoming_order.deliveryDay,
                total_value: c.upcoming_order.custom_price ?? c.upcoming_order.totalValue,
                notes: c.upcoming_order.notes,
                case_id: c.upcoming_order.caseId,
                custom_name: c.upcoming_order.custom_name,
                vendorId: c.upcoming_order.vendorId
            }));

        // Process Food Orders for summary
        if (foodOrdersForSummary && foodOrdersForSummary.length > 0) {
            for (const fo of foodOrdersForSummary) {
                const entry = clientStatusMap.get(fo.client_id);
                if (!entry) continue;

                const dayOrders = fo.delivery_day_orders;

                if (!dayOrders || typeof dayOrders !== 'object') continue;

                const summaries: string[] = [];
                for (const dayName of Object.keys(dayOrders)) {
                    const vendorSelections = dayOrders[dayName].vendorSelections || [];
                    for (const sel of vendorSelections) {
                        if (!sel.vendorId) continue;
                        const vendor = vendorMap.get(sel.vendorId);
                        if (!vendor) continue;
                        const vendorName = vendor.name;

                        const itemDetails: string[] = [];
                        if (sel.items) {
                            for (const [itemId, qty] of Object.entries(sel.items)) {
                                const q = Number(qty);
                                if (q > 0) {
                                    const mItem = menuItemMap.get(itemId) || mealItemMap.get(itemId);
                                    if (mItem) {
                                        const price = mItem.itemType === 'meal' ? (mItem.priceEach ?? 0) : (mItem.priceEach ?? mItem.value ?? 0);
                                        itemDetails.push(`${q}x ${mItem.name} ($${(price * q).toFixed(2)})`);
                                    }
                                }
                            }
                        }

                        // Track vendor (use first vendor found)
                        const entry = clientStatusMap.get(fo.client_id);
                        if (entry && entry.vendor === 'no vendor set') {
                            entry.vendor = vendorName;
                        }

                        if (itemDetails.length > 0) {
                            summaries.push(`Food: ${itemDetails.join(', ')} (${dayName})`);
                        } else {
                            summaries.push(`Food: No items specified (${dayName})`);
                        }
                    }
                }

                if (summaries.length > 0) {
                    entry.summary = summaries.join(' | ');
                }
            }
        }

        // Process Meal Orders for summary
        if (mealOrdersForSummary && mealOrdersForSummary.length > 0) {
            for (const mo of mealOrdersForSummary) {
                const entry = clientStatusMap.get(mo.client_id);
                if (!entry) continue;

                const rawSelections = typeof mo.meal_selections === 'string'
                    ? JSON.parse(mo.meal_selections)
                    : mo.meal_selections;

                if (!rawSelections) continue;

                const summaries: string[] = [];
                for (const [mealType, group] of Object.entries(rawSelections)) {
                    const groupData = group as any;
                    if (!groupData.vendorId) continue;
                    const vendor = vendorMap.get(groupData.vendorId);
                    if (!vendor) continue;
                    const vendorName = vendor.name;

                    const itemDetails: string[] = [];
                    if (groupData.items) {
                        for (const [itemId, qty] of Object.entries(groupData.items)) {
                            const q = Number(qty);
                            if (q > 0) {
                                const mItem = mealItemMap.get(itemId) || menuItemMap.get(itemId);
                                if (mItem) {
                                    const price = mItem.itemType === 'meal' ? (mItem.priceEach ?? 0) : (mItem.priceEach ?? mItem.value ?? 0);
                                    itemDetails.push(`${q}x ${mItem.name} ($${(price * q).toFixed(2)})`);
                                }
                            }
                        }
                    }

                    // Track vendor (use first vendor found)
                    const entry = clientStatusMap.get(mo.client_id);
                    if (entry && entry.vendor === 'no vendor set') {
                        entry.vendor = vendorName;
                    }

                    if (itemDetails.length > 0) {
                        summaries.push(`Meal (${mealType}): ${itemDetails.join(', ')}`);
                    } else {
                        summaries.push(`Meal (${mealType}): No items specified`);
                    }
                }

                if (summaries.length > 0) {
                    entry.summary = entry.summary ? `${entry.summary} | ${summaries.join(' | ')}` : summaries.join(' | ');
                }
            }
        }

        // Process Box Orders for summary
        if (boxOrdersForSummary && boxOrdersForSummary.length > 0) {
            for (const bo of boxOrdersForSummary) {
                const entry = clientStatusMap.get(bo.client_id);
                if (!entry) continue;

                const vendor = vendorMap.get(bo.vendor_id);
                if (!vendor) continue;
                const vendorName = vendor.name;

                const boxType = boxTypeMap.get(bo.box_type_id) || 'Standard Box';
                const qty = bo.quantity || 1;

                let boxValue = 0;
                if (bo.items) {
                    const itemsObj = typeof bo.items === 'string' ? JSON.parse(bo.items) : bo.items;
                    for (const [id, qty] of Object.entries(itemsObj)) {
                        const m = allMenuItems.find(x => x.id === id);
                        if (m) boxValue += (m.priceEach || m.value || 0) * Number(qty);
                    }
                }
                const totalBoxValue = boxValue * qty;

                // Track vendor
                if (entry.vendor === 'no vendor set') {
                    entry.vendor = vendorName;
                }

                const boxSummary = `Boxes: ${qty}x ${boxType} ($${totalBoxValue.toFixed(2)})`;
                entry.summary = entry.summary ? `${entry.summary} | ${boxSummary}` : boxSummary;
            }
        }

        // Process Custom Orders (from clients.upcoming_order)
        if (customOrdersFromClients && customOrdersFromClients.length > 0) {
            for (const co of customOrdersFromClients) {
                const entry = clientStatusMap.get(co.client_id);
                if (!entry) continue;

                const vendor = vendorMap.get(co.vendorId);
                const vendorName = vendor?.name || 'Unknown Vendor';
                if (entry.vendor === 'no vendor set') entry.vendor = vendorName;

                const name = co.custom_name || co.notes || 'Custom Item';
                const price = Number(co.total_value) || 0;
                const dayText = co.delivery_day ? ` (${co.delivery_day})` : '';
                const customSummary = `Custom: ${name} ($${price.toFixed(2)})${dayText}`;
                entry.summary = entry.summary ? `${entry.summary} | ${customSummary}` : customSummary;
            }
        }

        // Get Max Order Number
        const { data: maxOrderData } = await supabase
            .from('orders')
            .select('order_number')
            .order('order_number', { ascending: false })
            .limit(1)
            .maybeSingle();
        let nextOrderNumber = Math.max(100000, (maxOrderData?.order_number || 0) + 1);

        // --- Helper: Calculate current week (Sunday to Saturday) ---
        const getCurrentWeek = () => {
            const todayDate = new Date(today);
            const dayOfWeek = todayDate.getDay(); // 0 = Sunday, 6 = Saturday
            const weekStart = new Date(todayDate);
            weekStart.setDate(todayDate.getDate() - dayOfWeek); // Go back to Sunday
            weekStart.setHours(0, 0, 0, 0);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6); // Saturday
            weekEnd.setHours(23, 59, 59, 999);
            return { weekStart, weekEnd };
        };

        const { weekStart, weekEnd } = getCurrentWeek();

        // --- Helper: Calculate expected orders for this week ---
        const calculateExpectedOrdersForWeek = (clientId: string, client: any) => {
            const expectedOrders: Array<{ type: string, day: string, vendor: string, cutoffDay: string }> = [];

            // Check Food orders
            if (client.service_type === 'Food') {
                const foodOrder = foodOrdersForSummary?.find((fo: any) => fo.client_id === clientId);
                if (foodOrder) {
                    const dayOrders = typeof foodOrder.delivery_day_orders === 'string'
                        ? JSON.parse(foodOrder.delivery_day_orders)
                        : foodOrder.delivery_day_orders;

                    if (dayOrders) {
                        for (const [dayName, dayData] of Object.entries(dayOrders)) {
                            const dayDataTyped = dayData as any;
                            const vendorSelections = dayDataTyped.vendorSelections || [];
                            for (const sel of vendorSelections) {
                                if (!sel.vendorId) continue;
                                const vendor = vendorMap.get(sel.vendorId);
                                if (!vendor) continue;

                                const cutoff = vendor.cutoffDays || 0;
                                // Calculate when this order should be created (delivery day - cutoff)
                                const dayNumber = DAY_NAME_TO_NUMBER[dayName];
                                if (dayNumber !== undefined) {
                                    // Find this day in the current week
                                    const weekDay = new Date(weekStart);
                                    weekDay.setDate(weekStart.getDate() + dayNumber);

                                    if (weekDay >= weekStart && weekDay <= weekEnd) {
                                        // Calculate cutoff day (delivery day - cutoff)
                                        const cutoffDate = new Date(weekDay);
                                        cutoffDate.setDate(weekDay.getDate() - cutoff);
                                        const cutoffDayName = cutoffDate.toLocaleDateString('en-US', { weekday: 'long' });

                                        expectedOrders.push({
                                            type: 'Food',
                                            day: dayName,
                                            vendor: vendor.name,
                                            cutoffDay: cutoffDayName
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Check Meal orders
            if (client.service_type === 'Food' || client.service_type === 'Meal') {
                const mealOrder = mealOrdersForSummary?.find((mo: any) => mo.client_id === clientId);
                if (mealOrder) {
                    const rawSelections = typeof mealOrder.meal_selections === 'string'
                        ? JSON.parse(mealOrder.meal_selections)
                        : mealOrder.meal_selections;

                    if (rawSelections) {
                        for (const [mealType, group] of Object.entries(rawSelections)) {
                            const groupData = group as any;
                            if (!groupData.vendorId) continue;
                            const vendor = vendorMap.get(groupData.vendorId);
                            if (!vendor) continue;

                            const cutoff = vendor.cutoffDays || 0;
                            // Find first delivery day in this week
                            for (const deliveryDay of vendor.deliveryDays || []) {
                                const dayNumber = DAY_NAME_TO_NUMBER[deliveryDay];
                                if (dayNumber !== undefined) {
                                    const weekDay = new Date(weekStart);
                                    weekDay.setDate(weekStart.getDate() + dayNumber);

                                    if (weekDay >= weekStart && weekDay <= weekEnd) {
                                        const cutoffDate = new Date(weekDay);
                                        cutoffDate.setDate(weekDay.getDate() - cutoff);
                                        const cutoffDayName = cutoffDate.toLocaleDateString('en-US', { weekday: 'long' });

                                        expectedOrders.push({
                                            type: 'Meal',
                                            day: deliveryDay,
                                            vendor: vendor.name,
                                            cutoffDay: cutoffDayName
                                        });
                                        break; // Only one meal order per week
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Check Box orders
            if (client.service_type === 'Boxes') {
                const boxOrder = boxOrdersForSummary?.find((bo: any) => bo.client_id === clientId);
                if (boxOrder && boxOrder.vendor_id) {
                    const vendor = vendorMap.get(boxOrder.vendor_id);
                    if (vendor) {
                        const cutoff = vendor.cutoffDays || 0;
                        // Find first delivery day in this week
                        for (const deliveryDay of vendor.deliveryDays || []) {
                            const dayNumber = DAY_NAME_TO_NUMBER[deliveryDay];
                            if (dayNumber !== undefined) {
                                const weekDay = new Date(weekStart);
                                weekDay.setDate(weekStart.getDate() + dayNumber);

                                if (weekDay >= weekStart && weekDay <= weekEnd) {
                                    const cutoffDate = new Date(weekDay);
                                    cutoffDate.setDate(weekDay.getDate() - cutoff);
                                    const cutoffDayName = cutoffDate.toLocaleDateString('en-US', { weekday: 'long' });

                                    expectedOrders.push({
                                        type: 'Boxes',
                                        day: deliveryDay,
                                        vendor: vendor.name,
                                        cutoffDay: cutoffDayName
                                    });
                                    break; // Only one box order per week
                                }
                            }
                        }
                    }
                }
            }

            // Check Custom orders (from clients.upcoming_order)
            if (client.service_type === 'Custom') {
                const customOrder = customOrdersFromClients?.find((co: any) => co.client_id === clientId);
                if (customOrder && customOrder.delivery_day && customOrder.vendorId) {
                    const vendor = vendorMap.get(customOrder.vendorId);
                    if (vendor) {
                        const cutoff = vendor.cutoffDays || 0;
                        const dayNumber = DAY_NAME_TO_NUMBER[customOrder.delivery_day];
                        if (dayNumber !== undefined) {
                            const weekDay = new Date(weekStart);
                            weekDay.setDate(weekStart.getDate() + dayNumber);

                            if (weekDay >= weekStart && weekDay <= weekEnd) {
                                const cutoffDate = new Date(weekDay);
                                cutoffDate.setDate(weekDay.getDate() - cutoff);
                                const cutoffDayName = cutoffDate.toLocaleDateString('en-US', { weekday: 'long' });

                                expectedOrders.push({
                                    type: 'Custom',
                                    day: customOrder.delivery_day,
                                    vendor: vendor.name,
                                    cutoffDay: cutoffDayName
                                });
                            }
                        }
                    }
                }
            }

            return expectedOrders;
        };

        // Get next creation_id for this batch
        const creationId = await getNextCreationId();

        // --- 2. Order Processing Helpers ---

        // Helper: Check Client Eligibility (Global Rule)
        function isClientEligible(clientId: string): boolean {
            const client = clientMap.get(clientId);
            if (!client) return false;
            const status = statusMap.get(client.status_id);
            return status?.deliveriesAllowed ?? false;
        }

        // Helper: Create Order Record
        async function createOrder(
            clientId: string,
            serviceType: 'Food' | 'Meal' | 'Boxes' | 'Custom',
            deliveryDate: Date,
            itemsData: any,
            vendorId: string | null,
            totalValue: number,
            totalItems: number,
            notes: string | null,
            caseId: string | undefined, // Fixed type
            assignedOrderNumber: number // Must pass valid number!
        ) {
            try {
                const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
                const { data: newOrder, error: orderErr } = await supabase
                    .from('orders')
                    .insert({
                        client_id: clientId,
                        service_type: serviceType,
                        status: 'scheduled',
                        scheduled_delivery_date: deliveryDateStr,
                        total_value: totalValue,
                        total_items: totalItems,
                        order_number: assignedOrderNumber,
                        // Don't set created_at - let database use NOW() for real server time (not affected by fake time)
                        last_updated: currentTime.toISOString(),
                        notes: notes,
                        case_id: caseId || `CASE-${Date.now()}`,
                        creation_id: creationId
                    })
                    .select()
                    .single();

                if (orderErr) throw orderErr;

                // Track Stats
                report.totalCreated++;
                if (serviceType === 'Food') report.breakdown.Food++;
                else if (serviceType === 'Meal') report.breakdown.Meal++;
                else if (serviceType === 'Boxes') report.breakdown.Boxes++;
                else if (serviceType === 'Custom') report.breakdown.Custom++;

                return newOrder;
            } catch (err: any) {
                const client = clientMap.get(clientId);
                logUnexpected(client?.full_name || clientId, serviceType, deliveryDate.toISOString(), `Create Order Failed: ${err.message}`);
                return null;
            }
        }

        // Batch Processing Helper
        async function processBatch<T>(items: T[], fn: (item: T) => Promise<void>, batchSize = 15) {
            for (let i = 0; i < items.length; i += batchSize) {
                const chunk = items.slice(i, i + batchSize);
                await Promise.all(chunk.map(fn));
            }
        }

        // --- 3. Process FOOD Orders (from clients.upcoming_order) ---
        const foodOrders = (clients || [])
            .filter((c: any) => c.service_type === 'Food' && c.upcoming_order?.deliveryDayOrders)
            .map((c: any) => ({
                client_id: c.id,
                delivery_day_orders: c.upcoming_order.deliveryDayOrders,
                notes: c.upcoming_order.notes ?? null,
                case_id: c.upcoming_order.caseId ?? null
            }));
        if (foodOrders.length > 0) {
            await processBatch(foodOrders, async (fo) => {
                if (!isClientEligible(fo.client_id)) return;
                const client = clientMap.get(fo.client_id);
                if (client?.service_type !== 'Food') return;

                const dayOrders = typeof fo.delivery_day_orders === 'string'
                    ? JSON.parse(fo.delivery_day_orders)
                    : fo.delivery_day_orders;

                if (!dayOrders) return;

                for (const dayName of Object.keys(dayOrders)) {
                    const vendorSelections = dayOrders[dayName].vendorSelections || [];
                    for (const sel of vendorSelections) {
                        if (!sel.vendorId) continue;
                        const vendor = vendorMap.get(sel.vendorId);
                        if (!vendor) continue;

                        const cutoff = vendor.cutoffDays || 0;
                        const targetDate = new Date(today);
                        targetDate.setDate(today.getDate() + cutoff);
                        const targetDayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' });

                        if (targetDayName !== dayName) {
                            setClientStatus(fo.client_id, 'food', `Not today's target (Next delivery: ${dayName})`);
                            continue; // Not today's target
                        }

                        const deliveryDate = targetDate;

                        // Check for duplicates
                        // NOTE: In parallel processing, strictly relying on DB state for 'exists' check is race-prone 
                        // if multiple threads target the SAME client+date.
                        // However, we are iterating unique Client configurations. 
                        // A single client is processed in one thread (one item in foodOrders array).
                        // So no race condition for the same client.

                        const { count } = await supabase
                            .from('orders')
                            .select('*', { count: 'exact', head: true })
                            .eq('client_id', fo.client_id)
                            .eq('scheduled_delivery_date', deliveryDate.toISOString().split('T')[0])
                            .eq('service_type', 'Food');

                        let isDuplicate = false;
                        if (count && count > 0) {
                            const { data: existingOrders } = await supabase
                                .from('orders')
                                .select('id')
                                .eq('client_id', fo.client_id)
                                .eq('scheduled_delivery_date', deliveryDate.toISOString().split('T')[0])
                                .eq('service_type', 'Food');

                            if (existingOrders && existingOrders.length > 0) {
                                const { count: vendorCount } = await supabase
                                    .from('order_vendor_selections')
                                    .select('*', { count: 'exact', head: true })
                                    .in('order_id', existingOrders.map(o => o.id))
                                    .eq('vendor_id', sel.vendorId);

                                if (vendorCount && vendorCount > 0) isDuplicate = true;
                            }
                        }

                        if (isDuplicate) {
                            setClientStatus(fo.client_id, 'food', `Duplicate order already exists for ${deliveryDate.toISOString().split('T')[0]}`);
                            continue;
                        }

                        // Create Food Order
                        let itemsTotal = 0;
                        let valueTotal = 0;
                        const itemsList = [];

                        if (sel.items) {
                            for (const [itemId, qty] of Object.entries(sel.items)) {
                                const q = Number(qty);
                                if (q > 0) {
                                    // Map Optimization
                                    const mItem = menuItemMap.get(itemId) || mealItemMap.get(itemId);
                                    if (mItem) {
                                        const price = mItem.itemType === 'meal' ? (mItem.priceEach ?? 0) : (mItem.priceEach ?? mItem.value ?? 0);
                                        itemsTotal += q;
                                        valueTotal += price * q;
                                        itemsList.push({
                                            menu_item_id: itemId,
                                            quantity: q,
                                            unit_value: price,
                                            total_value: price * q,
                                            notes: sel.itemNotes?.[itemId] || null
                                        });
                                    }
                                }
                            }
                        }

                        if (itemsList.length === 0) continue;

                        // Atomic Order Number
                        const assignedId = nextOrderNumber++;

                        const newOrder = await createOrder(
                            fo.client_id,
                            'Food',
                            deliveryDate,
                            null,
                            null,
                            valueTotal,
                            itemsTotal,
                            (fo as any).notes || null,
                            fo.case_id,
                            assignedId
                        );

                        if (newOrder) {
                            // Update status to show order was created
                            setClientStatus(fo.client_id, 'food', `Order created for ${vendor.name} on ${deliveryDate.toISOString().split('T')[0]}`);

                            // Track vendor and order creation info
                            const entry = clientStatusMap.get(fo.client_id);
                            if (entry) {
                                entry.vendor = vendor.name;
                                entry.orderCreated = true;
                                entry.scheduledDeliveryDate = newOrder.scheduled_delivery_date || deliveryDate.toISOString().split('T')[0];
                                // Track order created in this run
                                entry.ordersCreatedThisRun.push({
                                    type: 'Food',
                                    date: deliveryDate.toISOString().split('T')[0],
                                    vendor: vendor.name,
                                    logic: `MATCH: Target Delivery=${dayName}. Vendor Cutoff=${cutoff} days. Required Creation=${today.toLocaleDateString('en-US', { weekday: 'long' })}. Today=${today.toLocaleDateString('en-US', { weekday: 'long' })} -> MATCH.`
                                });
                            }

                            const { data: vs } = await supabase.from('order_vendor_selections').insert({
                                order_id: newOrder.id,
                                vendor_id: sel.vendorId
                            }).select().single();

                            if (vs) {
                                const itemsPayload = itemsList.map(i => ({
                                    ...i,
                                    vendor_selection_id: vs.id,
                                    order_id: newOrder.id
                                }));
                                await supabase.from('order_items').insert(itemsPayload);
                            }
                        }
                    }
                }
            });
        }

        // --- 4. Process MEAL / BOX Orders ---
        // Logic: "Evaluated EVERY time... At most ONE per week."
        // Delivery Date: Start Today -> Apply Cutoff -> Find earliest vendor day.

        async function processPeriodicOrder(
            template: any,
            type: 'Meal' | 'Boxes',
            templateItemsHelper: (t: any) => any,
            maxLimit?: number
        ) {
            if (!isClientEligible(template.client_id)) return;
            const client = clientMap.get(template.client_id);

            // Type check: Meal applies to Food clients too. Boxes applies to Boxes clients.
            if (type === 'Boxes' && client?.service_type !== 'Boxes') return;
            if (type === 'Meal' && (client?.service_type !== 'Food' && client?.service_type !== 'Meal')) return;

            // Vendor Assignment Check
            const vendorId = template.vendor_id || (templateItemsHelper(template)?.vendorId); // Extract vendor

            // For Meal, vendor might be inside selections structure.
            // Let's normalize extraction.
            let targetVendorId = vendorId;
            let selections = null;

            if (type === 'Meal') {
                selections = typeof template.meal_selections === 'string' ? JSON.parse(template.meal_selections) : template.meal_selections;
                // Identify PRIMARY vendor (some meals might differ, but typically one main delivery?)
                // Actually spec says: "Start from today, Apply cutoff, Select earliest vendor delivery day".
                // We should process per Vendor if multiple? 
                // "Meal orders are evaluated EVERY time... At most ONE Meal order may be created per client per week."
                // This implies a SINGLE aggregated order or single main delivery.
                // Current UI/Logic suggests Meal Orders are usually one vendor or aggregated.
                // Let's assume one main Vendor for delivery calculation.
                // If multiple vendors, it gets complex. Let's find the FIRST valid vendor in selections.

                if (selections) {
                    for (const k of Object.keys(selections)) {
                        if (selections[k].vendorId) {
                            targetVendorId = selections[k].vendorId;
                            break;
                        }
                    }
                }
            } else {
                // For boxes, vendor_id is on the record
                targetVendorId = template.vendor_id;
            }

            if (!targetVendorId) return; // Expected Skip (No Vendor)
            const vendor = vendorMap.get(targetVendorId);
            if (!vendor) return;

            // Date Calculation
            // 1. Start Today. 2. Apply Cutoff.
            const cutoff = vendor.cutoffDays || 0;
            const minDate = new Date(today);
            minDate.setDate(today.getDate() + cutoff);

            // 3. Select earliest vendor delivery day AFTER (or equal) minDate
            const validDays = vendor.deliveryDays || []; // ["Monday", ...]
            if (validDays.length === 0) return;

            let candidateDate: Date | null = null;
            // Scan next 7 days from minDate to find match
            for (let i = 0; i < 7; i++) {
                const d = new Date(minDate);
                d.setDate(minDate.getDate() + i);
                const dName = d.toLocaleDateString('en-US', { weekday: 'long' });
                if (validDays.includes(dName)) {
                    candidateDate = d;
                    break;
                }
            }

            if (!candidateDate) return; // No valid day found (weird)

            // BUG FIX: Check if candidate date is within reasonable cutoff window
            // The candidate date should be at least 'cutoff' days away, but not too far
            // We allow up to cutoff + 3 days to account for vendors with infrequent delivery days
            const daysUntilCandidate = Math.round((candidateDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            const maxDaysAllowed = cutoff + 3; // Allow some flexibility for infrequent delivery days

            if (daysUntilCandidate < cutoff || daysUntilCandidate > maxDaysAllowed) {
                setClientStatus(template.client_id, type.toLowerCase() as 'meal' | 'box',
                    `Not on cutoff day - candidate date ${candidateDate.toISOString().split('T')[0]} is ${daysUntilCandidate} days away (cutoff: ${cutoff}, max: ${maxDaysAllowed})`);
                return; // Skip - too far in advance or too soon
            }

            // Weekly Limit Check
            // "If Meal order exists for a week (by delivery date)..."
            // We check the WEEK of candidateDate.
            const cDate = new Date(candidateDate);
            const dayNum = cDate.getDay(); // 0 Sun
            const weekStart = new Date(cDate);
            weekStart.setDate(cDate.getDate() - dayNum); // Sunday
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6); // Saturday

            const startStr = weekStart.toISOString().split('T')[0];
            const endStr = weekEnd.toISOString().split('T')[0];

            const { count } = await supabase
                .from('orders')
                .select('*', { count: 'exact', head: true })
                .eq('client_id', template.client_id)
                .eq('service_type', type) // 'Meal' or 'Boxes'
                .gte('scheduled_delivery_date', startStr)
                .lte('scheduled_delivery_date', endStr);

            // Safe Multi-Box Logic: Allow up to 'maxLimit' orders per week (default 1)
            // This ensures we can create multiple DISTINCT boxes if configured, but stops if we already have them.
            const limit = maxLimit || 1;
            if (count && count >= limit) {
                setClientStatus(template.client_id, type.toLowerCase() as 'meal' | 'box', `Weekly limit reached - ${count} orders already exist for this week (Limit: ${limit})`);
                return; // Expected Skip (Weekly Limit)
            }

            // Special Check: Is TODAY the correct day to generate this?
            // "Meal orders are evaluated EVERY time." 
            // "At most ONE...".
            // If we are 5 days before delivery, and limit not reached, we create it.
            // If we are 1 day before (and meets cutoff), we create it.
            // Basically, as soon as we CAN create it (meeting cutoff), we should?
            // Spec doesn't strictly say "Create on Cutoff Day". 
            // It says "Start from today... apply cutoff... select earliest".
            // This implies dynamic targeting. 
            // BUT, if we create it today for delivery in 3 days. 
            // Tomorrow, we run again. Weekly limit prevents duplicate.
            // So this logic is sound: Create ASAP.

            // Wait, "Creation Rule (Food): STRICT SINGLE-DAY WINDOW".
            // "Meal Orders... Creation Frequency: Evaluated EVERY time."
            // This suggests JIT or Earliest Possible?
            // If we assume "Earliest Possible" that respects Cutoff.

            // Let's create it.

            // Prepare Items
            let itemsTotal = 0;
            let valueTotal = 0;
            // ... (Logic to extract items similar to Food but specific to Box/Meal structure)

            // Execute Creation
            if (type === 'Boxes') {
                // Box Logic
                const boxItems = template.items; // { id: qty } (already parsed if object)
                let boxValue = 0;
                if (boxItems) {
                    // Check if boxItems is string, parse if needed (though supabase returns jsonb as object)
                    const itemsObj = typeof boxItems === 'string' ? JSON.parse(boxItems) : boxItems;
                    for (const [id, qty] of Object.entries(itemsObj)) {
                        const m = allMenuItems.find(x => x.id === id);
                        if (m) boxValue += (m.priceEach || m.value || 0) * Number(qty);
                    }
                }
                const totalBoxValue = boxValue * (template.quantity || 1);

                const newOrder = await createOrder(
                    template.client_id,
                    'Boxes',
                    candidateDate,
                    null,
                    targetVendorId,
                    totalBoxValue,
                    template.quantity || 1,
                    (template as any).notes || null,
                    template.case_id,
                    nextOrderNumber++
                );

                if (newOrder) {
                    // Update status
                    const vendor = vendorMap.get(targetVendorId);
                    setClientStatus(template.client_id, 'box', `Order created for ${vendor?.name || 'vendor'} on ${candidateDate.toISOString().split('T')[0]}`);

                    // Track vendor and order creation info
                    const entry = clientStatusMap.get(template.client_id);
                    if (entry && vendor) {
                        if (entry.vendor === 'no vendor set') {
                            entry.vendor = vendor.name;
                        }
                        entry.orderCreated = true;
                        entry.scheduledDeliveryDate = newOrder.scheduled_delivery_date || candidateDate.toISOString().split('T')[0];
                        // Track order created in this run
                        entry.ordersCreatedThisRun.push({
                            type: 'Boxes',
                            date: candidateDate.toISOString().split('T')[0],
                            vendor: vendor.name,
                            logic: `ALLOWED: Client has ${maxLimit || 1} box templates. Found ${count || 0} existing orders this week. Limit is ${maxLimit || 1}. Created #${(count || 0) + 1}.`
                        });
                    }

                    // Box Selection
                    // Ensure box_type_id is null if it's an empty string or undefined
                    const boxTypeId = template.box_type_id && template.box_type_id !== '' ? template.box_type_id : null;

                    const { error: boxSelError } = await supabase.from('order_box_selections').insert({
                        order_id: newOrder.id,
                        vendor_id: targetVendorId,
                        box_type_id: boxTypeId,
                        quantity: template.quantity,
                        unit_value: boxValue,
                        total_value: totalBoxValue,
                        items: template.items,
                        item_notes: template.itemNotes ?? {}
                    });

                    if (boxSelError) {
                        console.error(`[Unified Scheduling] Failed to create box selection for order ${newOrder.id}:`, boxSelError);
                    }
                }

            } else {
                // Meal Logic
                // Structure: template.meal_selections (JSON) -> { "Breakfast": { vendorId: "...", items: {...} } }
                const rawSelections = typeof template.meal_selections === 'string'
                    ? JSON.parse(template.meal_selections)
                    : template.meal_selections;

                if (!rawSelections) return;

                // 1. Create Order Shell FIRST (We need ID to link items)
                const newOrder = await createOrder(
                    template.client_id,
                    'Meal',
                    candidateDate,
                    null,
                    null, // No single vendor
                    0, // Value calc later
                    0, // Items calc later
                    (template as any).notes || null,
                    template.case_id,
                    nextOrderNumber++
                );

                if (newOrder) {
                    // Update status
                    setClientStatus(template.client_id, 'meal', `Order created on ${candidateDate.toISOString().split('T')[0]}`);

                    // Track vendor and order creation info
                    const entry = clientStatusMap.get(template.client_id);
                    if (entry && targetVendorId) {
                        const vendor = vendorMap.get(targetVendorId);
                        if (vendor) {
                            if (entry.vendor === 'no vendor set') {
                                entry.vendor = vendor.name;
                            }
                        }
                        entry.orderCreated = true;
                        entry.scheduledDeliveryDate = newOrder.scheduled_delivery_date || candidateDate.toISOString().split('T')[0];
                        // Track order created in this run
                        entry.ordersCreatedThisRun.push({
                            type: 'Meal',
                            date: candidateDate.toISOString().split('T')[0],
                            vendor: vendor?.name || 'Unknown',
                            logic: `ALLOWED: Meal Limit=1/week. Existing orders found=${count || 0}. Slot available -> Order Created.`
                        });
                    }

                    let orderTotalValue = 0;
                    let orderTotalItems = 0;

                    // Group by Vendor to create VendorSelections
                    // Map <VendorId, { items: [], notes: {} }>
                    const vendorGroups = new Map<string, any>();

                    for (const [mealType, conf] of Object.entries(rawSelections)) {
                        const c = conf as any;
                        if (!c.vendorId) continue;

                        if (!vendorGroups.has(c.vendorId)) {
                            vendorGroups.set(c.vendorId, { items: {}, notes: {} });
                        }
                        const group = vendorGroups.get(c.vendorId);

                        // Merge items
                        if (c.items) {
                            for (const [itemId, qty] of Object.entries(c.items)) {
                                const q = Number(qty);
                                if (q > 0) {
                                    group.items[itemId] = (group.items[itemId] || 0) + q;
                                    if (c.itemNotes && c.itemNotes[itemId]) {
                                        group.notes[itemId] = c.itemNotes[itemId];
                                    }
                                }
                            }
                        }
                    }

                    // Process Groups
                    for (const [vId, group] of vendorGroups.entries()) {
                        // Create Vendor Selection
                        const { data: vs, error: vsError } = await supabase.from('order_vendor_selections').insert({
                            order_id: newOrder.id,
                            vendor_id: vId
                        }).select().single();

                        if (vsError || !vs) {
                            console.error(`[Unified Scheduling] Failed to create VS for Meal Order ${newOrder.id}`, vsError);
                            continue;
                        }

                        // Insert Items
                        for (const [itemId, qty] of Object.entries(group.items)) {
                            const q = Number(qty);
                            const mItem = allMealItems.find(i => i.id === itemId) || allMenuItems.find(i => i.id === itemId);
                            // Meal items: use only price_each (value is quota_value, not price). Menu items: price_each or value.
                            const price = mItem
                                ? (mItem.itemType === 'meal'
                                    ? (mItem.priceEach ?? 0)
                                    : (mItem.priceEach ?? mItem.value ?? 0))
                                : 0;
                            const total = price * q;

                            await supabase.from('order_items').insert({
                                order_id: newOrder.id,
                                vendor_selection_id: vs.id,
                                menu_item_id: itemId,
                                quantity: q,
                                unit_value: price,
                                total_value: total,
                                notes: group.notes[itemId] || null
                            });

                            orderTotalValue += total;
                            orderTotalItems += q;
                        }
                    }

                    // Update Order Totals
                    await supabase.from('orders').update({
                        total_value: orderTotalValue,
                        total_items: orderTotalItems
                    }).eq('id', newOrder.id);
                }
            }
        }

        // Execute Meal/Box Processing (from clients.upcoming_order, batched)
        const mealOrders = (clients || [])
            .filter((c: any) => (c.service_type === 'Food' || c.service_type === 'Meal') && c.upcoming_order?.mealSelections)
            .map((c: any) => ({
                client_id: c.id,
                meal_selections: c.upcoming_order.mealSelections,
                notes: c.upcoming_order.notes ?? null,
                case_id: c.upcoming_order.caseId ?? null
            }));
        if (mealOrders.length > 0) {
            await processBatch(mealOrders, (mo) => processPeriodicOrder(mo, 'Meal', (t) => null));
        }

        const boxOrders: { client_id: string; vendor_id?: string; box_type_id?: string; quantity: number; items: any }[] = [];
        for (const c of clients || []) {
            if (c.service_type !== 'Boxes' || !c.upcoming_order?.boxOrders?.length) continue;
            if (hasBlockingCleanupIssues(c.upcoming_order, blockCtx)) continue;
            for (const b of c.upcoming_order.boxOrders) {
                boxOrders.push({
                    client_id: c.id,
                    vendor_id: b.vendorId,
                    box_type_id: b.boxTypeId,
                    quantity: b.quantity ?? 1,
                    items: b.items ?? {}
                });
            }
        }
        if (boxOrders.length > 0) {
            const boxCountByClient = new Map<string, number>();
            for (const bo of boxOrders) {
                const current = boxCountByClient.get(bo.client_id) || 0;
                boxCountByClient.set(bo.client_id, current + 1);
            }

            await processBatch(boxOrders, (bo) => {
                const limit = boxCountByClient.get(bo.client_id) || 1;
                return processPeriodicOrder(bo, 'Boxes', (t) => ({ vendorId: t.vendor_id }), limit);
            });
        }

        // --- 5. Process CUSTOM Orders (from clients.upcoming_order) ---
        if (customOrdersFromClients && customOrdersFromClients.length > 0) {
            await processBatch(customOrdersFromClients, async (co) => {
                if (!isClientEligible(co.client_id)) return;

                if (!co.delivery_day) return;

                const vendorId = co.vendorId;
                if (!vendorId) return;

                const vendor = vendorMap.get(vendorId);
                const cutoff = vendor?.cutoffDays || 0;

                const targetDate = new Date(today);
                targetDate.setDate(today.getDate() + cutoff);
                const targetDayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' });

                if (targetDayName !== co.delivery_day) return;

                const deliveryDate = targetDate;

                // Weekly Limit Check
                const cDate = new Date(deliveryDate);
                const dayNum = cDate.getDay();
                const weekStart = new Date(cDate);
                weekStart.setDate(cDate.getDate() - dayNum);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);

                const { count } = await supabase
                    .from('orders')
                    .select('*', { count: 'exact', head: true })
                    .eq('client_id', co.client_id)
                    .eq('service_type', 'Custom')
                    .gte('scheduled_delivery_date', weekStart.toISOString().split('T')[0])
                    .lte('scheduled_delivery_date', weekEnd.toISOString().split('T')[0]);

                if (count && count > 0) {
                    setClientStatus(co.client_id, 'custom', `Weekly limit reached - custom order already exists for this week`);
                    return;
                }

                const totalValue = Number(co.total_value) || 0;
                const assignedId = nextOrderNumber++;
                const newOrder = await createOrder(
                    co.client_id,
                    'Custom',
                    deliveryDate,
                    null,
                    vendorId,
                    totalValue,
                    1,
                    co.notes ?? null,
                    co.case_id ?? undefined,
                    assignedId
                );

                if (newOrder) {
                    // Update status
                    setClientStatus(co.client_id, 'custom', `Order created for ${vendor?.name || 'vendor'} on ${deliveryDate.toISOString().split('T')[0]}`);

                    // Track vendor and order creation info
                    const entry = clientStatusMap.get(co.client_id);
                    if (entry && vendor) {
                        if (entry.vendor === 'no vendor set') {
                            entry.vendor = vendor.name;
                        }
                        entry.orderCreated = true;
                        entry.scheduledDeliveryDate = newOrder.scheduled_delivery_date || deliveryDate.toISOString().split('T')[0];
                        // Track order created in this run
                        entry.ordersCreatedThisRun.push({
                            type: 'Custom',
                            date: deliveryDate.toISOString().split('T')[0],
                            vendor: vendor.name,
                            logic: `MATCH: Custom Template for ${targetDayName}. Today matches creation window (Day - ${cutoff} days). No duplicate found -> Created.`
                        });
                    }

                    const { data: newVs } = await supabase.from('order_vendor_selections').insert({
                        order_id: newOrder.id,
                        vendor_id: vendorId
                    }).select().single();

                    if (newVs) {
                        // Single custom item from clients.upcoming_order
                        const itemName = co.custom_name || co.notes || 'Custom Item';
                        await supabase.from('order_items').insert({
                            order_id: newOrder.id,
                            vendor_selection_id: newVs.id,
                            menu_item_id: null,
                            custom_name: itemName,
                            custom_price: totalValue,
                            quantity: 1,
                            unit_value: totalValue,
                            total_value: totalValue,
                            notes: co.notes ?? null
                        });
                    }
                }
            });
        }

        // Calculate expected orders for all clients (after all data is loaded and orders processed)
        for (const client of clients) {
            const entry = clientStatusMap.get(client.id);
            if (entry) {
                entry.expectedOrdersThisWeek = calculateExpectedOrdersForWeek(client.id, client);
            }
        }

        // --- 6. Generate Excel Report and Send Email ---
        console.log('[Unified Scheduling] Complete. Generating Excel and sending report...');

        // Helper: Get orders created this week from database
        // Check both orders created in this run AND existing orders from previous runs
        const weekStartStr = weekStart.toISOString().split('T')[0];
        const weekEndStr = weekEnd.toISOString().split('T')[0];

        // Get orders created in this run
        const { data: ordersThisWeekThisRun } = await supabase
            .from('orders')
            .select('id, client_id, service_type, scheduled_delivery_date, creation_id, order_number')
            .gte('scheduled_delivery_date', weekStartStr)
            .lte('scheduled_delivery_date', weekEndStr)
            .eq('creation_id', creationId);

        // Get ALL existing orders for this week (from any creation run)
        const { data: allOrdersThisWeek } = await supabase
            .from('orders')
            .select('id, client_id, service_type, scheduled_delivery_date, creation_id, order_number')
            .gte('scheduled_delivery_date', weekStartStr)
            .lte('scheduled_delivery_date', weekEndStr)
            .in('status', ['scheduled', 'pending', 'confirmed', 'processing']); // Only active orders

        // Group orders by client (use all orders to check if they already exist)
        const ordersByClient = new Map<string, Array<{ type: string, date: string, isNew: boolean, orderNumber: number | null }>>();
        (allOrdersThisWeek || []).forEach((order: any) => {
            if (!ordersByClient.has(order.client_id)) {
                ordersByClient.set(order.client_id, []);
            }
            const isNew = (ordersThisWeekThisRun || []).some(o => o.id === order.id);
            ordersByClient.get(order.client_id)!.push({
                type: order.service_type,
                date: order.scheduled_delivery_date,
                isNew,
                orderNumber: order.order_number || null
            });
        });

        // Helper: Check if cutoff day has passed
        const hasCutoffDayPassed = (cutoffDayName: string): boolean => {
            const todayDayNum = today.getDay(); // 0 = Sunday, 6 = Saturday
            const cutoffDayNum = DAY_NAME_TO_NUMBER[cutoffDayName];
            if (cutoffDayNum === undefined) return false;

            // If today is past the cutoff day in this week, it's missed
            return todayDayNum > cutoffDayNum;
        };

        // Helper: Check if order was missed (cutoff day passed but not created)
        const checkMissedOrders = (entry: typeof clientStatusMap extends Map<any, infer V> ? V : never, clientId: string): boolean => {
            const expected = entry.expectedOrdersThisWeek || [];
            const created = ordersByClient.get(clientId) || [];

            if (expected.length === 0) return false;

            // Group expected orders by type to count properly
            const expectedByType = new Map<string, number>();
            expected.forEach(exp => {
                expectedByType.set(exp.type, (expectedByType.get(exp.type) || 0) + 1);
            });

            const createdByType = new Map<string, number>();
            created.forEach(cre => {
                createdByType.set(cre.type, (createdByType.get(cre.type) || 0) + 1);
            });

            // Check each expected order type
            for (const [type, expectedCount] of expectedByType.entries()) {
                const createdCount = createdByType.get(type) || 0;

                // If we're missing orders of this type, check if any cutoff days have passed
                if (createdCount < expectedCount) {
                    // Find all expected orders of this type and check their cutoff days
                    const expectedOfThisType = expected.filter(e => e.type === type);
                    for (const exp of expectedOfThisType) {
                        // If cutoff day has passed and we still need more orders of this type, it's missed
                        if (hasCutoffDayPassed(exp.cutoffDay)) {
                            return true;
                        }
                    }
                }
            }

            return false;
        };

        // Helper: Generate "Is order expected this week" status (clearer messages)
        const getOrderExpectedStatus = (entry: typeof clientStatusMap extends Map<any, infer V> ? V : never, clientId: string) => {
            const expected = entry.expectedOrdersThisWeek || [];
            const created = ordersByClient.get(clientId) || [];

            if (expected.length === 0) {
                return 'No orders expected this week';
            }

            // Count orders by type (ignore isNew flag for counting)
            const expectedByType = new Map<string, number>();
            const createdByType = new Map<string, number>();

            expected.forEach(exp => {
                expectedByType.set(exp.type, (expectedByType.get(exp.type) || 0) + 1);
            });

            created.forEach(cre => {
                createdByType.set(cre.type, (createdByType.get(cre.type) || 0) + 1);
            });

            // Check if all expected orders are created (either new or existing)
            let allCreated = true;
            for (const [type, count] of expectedByType.entries()) {
                if ((createdByType.get(type) || 0) < count) {
                    allCreated = false;
                    break;
                }
            }

            if (allCreated && created.length >= expected.length) {
                const newCount = created.filter(c => c.isNew).length;
                const existingCount = created.filter(c => !c.isNew).length;
                if (newCount > 0 && existingCount > 0) {
                    return `✓ All orders created (${newCount} new, ${existingCount} existing)`;
                } else if (newCount > 0) {
                    return `✓ All orders created this run (${newCount} new)`;
                } else {
                    return `✓ All orders already existed from previous run`;
                }
            }

            // Find which orders are still expected (not yet created)
            const stillExpected: Array<{ type: string, cutoffDay: string, deliveryDay: string, isMissed: boolean }> = [];
            for (const exp of expected) {
                const createdCount = created.filter(c => c.type === exp.type).length;
                const expectedCount = expected.filter(e => e.type === exp.type).length;
                if (createdCount < expectedCount) {
                    const isMissed = hasCutoffDayPassed(exp.cutoffDay);
                    stillExpected.push({
                        type: exp.type,
                        cutoffDay: exp.cutoffDay,
                        deliveryDay: exp.day,
                        isMissed
                    });
                }
            }

            if (created.length === 0) {
                // No orders created yet - check if any are missed
                const missedOrders = stillExpected.filter(e => e.isMissed);
                if (missedOrders.length > 0) {
                    const earliestMissed = missedOrders.reduce((earliest, exp) => {
                        const cutoffDayNum = DAY_NAME_TO_NUMBER[exp.cutoffDay];
                        const earliestDayNum = DAY_NAME_TO_NUMBER[earliest.cutoffDay];
                        return cutoffDayNum !== undefined && earliestDayNum !== undefined && cutoffDayNum < earliestDayNum ? exp : earliest;
                    }, missedOrders[0]);
                    return `⚠ MISSED: Should have been created on ${earliestMissed.cutoffDay} (cutoff day already passed)`;
                }

                // Not missed yet, will be created in future
                const earliestCutoff = expected.reduce((earliest, exp) => {
                    const cutoffDayNum = DAY_NAME_TO_NUMBER[exp.cutoffDay];
                    const earliestDayNum = DAY_NAME_TO_NUMBER[earliest.cutoffDay];
                    return cutoffDayNum !== undefined && earliestDayNum !== undefined && cutoffDayNum < earliestDayNum ? exp : earliest;
                }, expected[0]);
                return `→ Will be created on ${earliestCutoff.cutoffDay} (cutoff day is in the future)`;
            }

            // Some orders created, check remaining ones
            const missedOrders = stillExpected.filter(e => e.isMissed);
            const futureOrders = stillExpected.filter(e => !e.isMissed);

            const newCount = created.filter(c => c.isNew).length;
            const existingCount = created.filter(c => !c.isNew).length;

            if (missedOrders.length > 0) {
                const earliestMissed = missedOrders.reduce((earliest, exp) => {
                    const cutoffDayNum = DAY_NAME_TO_NUMBER[exp.cutoffDay];
                    const earliestDayNum = DAY_NAME_TO_NUMBER[earliest.cutoffDay];
                    return cutoffDayNum !== undefined && earliestDayNum !== undefined && cutoffDayNum < earliestDayNum ? exp : earliest;
                }, missedOrders[0]);
                const createdText = existingCount > 0
                    ? `${created.length} total (${newCount} new, ${existingCount} existing)`
                    : `${created.length} created`;
                return `⚠ MISSED: ${createdText}, but ${missedOrders.length} missed (cutoff ${earliestMissed.cutoffDay} already passed)`;
            }

            // Some orders created, some still expected in future
            const createdCount = created.length;
            const expectedCount = expected.length;
            const earliestRemaining = futureOrders.reduce((earliest, exp) => {
                const cutoffDayNum = DAY_NAME_TO_NUMBER[exp.cutoffDay];
                const earliestDayNum = DAY_NAME_TO_NUMBER[earliest.cutoffDay];
                return cutoffDayNum !== undefined && earliestDayNum !== undefined && cutoffDayNum < earliestDayNum ? exp : earliest;
            }, futureOrders[0]);

            const createdText = existingCount > 0
                ? `${createdCount} total (${newCount} new, ${existingCount} existing)`
                : `${createdCount} created`;
            return `✓ ${createdText}, ${futureOrders.length} will be created on ${earliestRemaining.cutoffDay} (cutoff day in future)`;
        };

        // --- 4. Generate Multi-Sheet Excel Report ---
        const wb = XLSX.utils.book_new();

        // Sheet 1: Order Statuses (Original Summary)
        const excelReportData = Array.from(clientStatusMap.entries()).map(([clientId, entry]) => {
            const createdOrders = ordersByClient.get(clientId) || [];

            // Use actual created orders from database
            const newOrders = createdOrders.filter(o => o.isNew);
            const existingOrders = createdOrders.filter(o => !o.isNew);

            let ordersCreatedText = '';
            if (newOrders.length > 0 && existingOrders.length > 0) {
                const newText = newOrders.map(o => `${o.type} on ${o.date}${o.orderNumber ? ` (#${o.orderNumber})` : ''}`).join(', ');
                const existingText = existingOrders.map(o => `${o.type} on ${o.date}${o.orderNumber ? ` (#${o.orderNumber})` : ''}`).join(', ');
                ordersCreatedText = `NEW: ${newText} | EXISTING: ${existingText}`;
            } else if (newOrders.length > 0) {
                ordersCreatedText = `NEW: ${newOrders.map(o => `${o.type} on ${o.date}${o.orderNumber ? ` (#${o.orderNumber})` : ''}`).join(', ')}`;
            } else if (existingOrders.length > 0) {
                ordersCreatedText = `EXISTING: ${existingOrders.map(o => `${o.type} on ${o.date}${o.orderNumber ? ` (#${o.orderNumber})` : ''}`).join(', ')}`;
            } else {
                ordersCreatedText = entry.orderCreated ? 'Yes (but not found in DB)' : 'No';
            }

            const expectedStatus = getOrderExpectedStatus(entry, clientId);
            const isMissed = checkMissedOrders(entry, clientId);
            const expectedCount = entry.expectedOrdersThisWeek.length;
            const expectedOrdersText = expectedCount > 0
                ? entry.expectedOrdersThisWeek.map(e => `${e.type} on ${e.day} (cutoff: ${e.cutoffDay})`).join('; ')
                : 'None';

            return {
                'Customer Name': entry.clientName,
                'Order Created': ordersCreatedText,
                'Scheduled Delivery Date': entry.scheduledDeliveryDate ? new Date(entry.scheduledDeliveryDate).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-',
                'Vendor': entry.vendor,
                'Summary': entry.summary || 'No upcoming orders',
                'Food Orders': entry.foodStatus,
                'Meal Orders': entry.mealStatus,
                'Box Orders': entry.boxStatus,
                'Custom Orders': entry.customStatus || 'No upcoming custom orders scheduled',
                'Is Order Expected This Week': expectedStatus,
                'Orders Expected For This Week': expectedOrdersText,
                'Expected Orders Count': expectedCount,
                'Missed For This Week': isMissed ? 'Yes' : 'No',
                'Creation ID': creationId
            };
        });

        const wsOriginal = XLSX.utils.json_to_sheet(excelReportData);
        wsOriginal['!cols'] = [
            { wch: 30 }, { wch: 30 }, { wch: 15 }, { wch: 20 }, { wch: 80 },
            { wch: 40 }, { wch: 40 }, { wch: 40 }, { wch: 40 },
            { wch: 70 }, { wch: 80 }, { wch: 20 }, { wch: 20 }, { wch: 12 }
        ];
        XLSX.utils.book_append_sheet(wb, wsOriginal, 'Order Statuses');

        // Sheet 2: Specific Order Logic (Previously Orders Created)
        const createdOrdersData = [];
        for (const [clientId, entry] of clientStatusMap.entries()) {
            if (entry.ordersCreatedThisRun.length > 0) {
                for (const order of entry.ordersCreatedThisRun) {
                    createdOrdersData.push({
                        'Client Name': entry.clientName,
                        'Order Type': order.type,
                        'Vendor': order.vendor,
                        'Delivery Date': order.date,
                        'Specific Logic': order.logic, // Renamed column
                        'Creation ID': creationId
                    });
                }
            }
        }
        const wsCreated = XLSX.utils.json_to_sheet(createdOrdersData.length > 0 ? createdOrdersData : [{ 'Message': 'No orders created this run' }]);
        wsCreated['!cols'] = [
            { wch: 30 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 100 }, { wch: 15 }
        ];
        XLSX.utils.book_append_sheet(wb, wsCreated, 'Specific Order Logic'); // Renamed Sheet

        // Sheet 3: Skipped Clients (Unchanged logic, just ensure it's there)
        const skippedData = [];
        // ... (Skipped data generation kept same)
        for (const [clientId, entry] of clientStatusMap.entries()) {
            if (entry.ordersCreatedThisRun.length === 0) {
                // Determine primary reason based on service type
                let reason = '';
                const client = clientMap.get(clientId);
                if (client) {
                    if (client.service_type === 'Food') reason = entry.foodStatus;
                    else if (client.service_type === 'Meal') reason = entry.mealStatus;
                    else if (client.service_type === 'Boxes') reason = entry.boxStatus;
                    else if (client.service_type === 'Custom') reason = entry.customStatus;
                    else reason = 'Unknown Service Type';
                }
                skippedData.push({
                    'Client Name': entry.clientName,
                    'Service Type': client?.service_type || '-',
                    'Reason for Skipping': reason,
                    'Vendor': entry.vendor !== 'no vendor set' ? entry.vendor : '-'
                });
            }
        }
        const wsSkipped = XLSX.utils.json_to_sheet(skippedData.length > 0 ? skippedData : [{ 'Message': 'All eligible clients received orders' }]);
        wsSkipped['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 80 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, wsSkipped, 'Skipped Clients');

        // Sheet 4: Rules Legend (Renamed from Order Logic)
        const logicData = [
            { 'Rule Type': 'Food Orders', 'Explanation': 'Food orders are created EXACTLY X days before delivery. If Cutoff is 3 days and delivery is Wednesday, order is created on Sunday.' },
            // ... (rest same)
            { 'Rule Type': 'Meal Orders', 'Explanation': 'Meal orders are evaluated daily. Logic finds the earliest valid vendor delivery day that meets the cutoff. Strict Limit: Only 1 Meal order per client per week.' },
            { 'Rule Type': 'Box Orders', 'Explanation': 'Box orders are evaluated daily. Count Matching: If you have 3 box templates, system creates up to 3 box orders per week. If 3 exist, it stops.' },
            { 'Rule Type': 'Custom Orders', 'Explanation': 'Custom orders are created if the current day matches the target creation day (Delivery Day - Cutoff). Strict Limit: Only 1 Custom order per client per week.' },
            { 'Rule Type': 'Skipped Reasons', 'Explanation': '"Weekly limit reached": Enough orders already exist. "Not on cutoff day": Today is not the correct day to create the order. "No vendor set": Template incomplete.' }
        ];
        const wsLogic = XLSX.utils.json_to_sheet(logicData);
        wsLogic['!cols'] = [{ wch: 20 }, { wch: 120 }];
        XLSX.utils.book_append_sheet(wb, wsLogic, 'Rules Legend'); // Renamed Sheet

        const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const excelAttachment = {
            filename: `Order_Scheduling_Report_${currentTime.toISOString().split('T')[0]}.xlsx`,
            content: excelBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };

        // Format the date used for order creation
        const orderCreationDateStr = today.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const orderCreationDayStr = today.toLocaleDateString('en-US', { weekday: 'long' });

        // Include creation_id and order creation date in the report
        const reportWithCreationId = {
            ...report,
            creationId: creationId,
            orderCreationDate: orderCreationDateStr,
            orderCreationDay: orderCreationDayStr
        };
        const emailResult = await sendSchedulingReport(reportWithCreationId, reportEmail, [excelAttachment]);

        // --- 7. Return Result ---
        return NextResponse.json({
            success: true,
            reportEmail: reportEmail,
            emailProvider: emailResult?.provider || null,
            report
        });

    } catch (error: any) {
        console.error('[Unified Scheduling] Critical Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
