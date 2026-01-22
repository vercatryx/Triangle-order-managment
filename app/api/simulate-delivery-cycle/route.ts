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

    function logUnexpected(clientName: string, type: string, date: string, reason: string) {
        // Reduced log noise - only log full errors if needed really
        // console.error(`[Unexpected Failure] ${clientName} | ${type} | ${reason}`);
        report.unexpectedFailures.push({ clientName, orderType: type, date, reason });
    }

    try {
        // --- 1. Load Global Context (Optimized) ---
        const currentTime = await getCurrentTime();
        const today = new Date(currentTime);
        today.setHours(0, 0, 0, 0);

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

        // Optimized Maps for O(1) Lookup
        const statusMap = new Map(allStatuses.map(s => [s.id, s]));
        const vendorMap = new Map(allVendors.map(v => [v.id, v]));
        const menuItemMap = new Map(allMenuItems.map(i => [i.id, i]));
        const mealItemMap = new Map(allMealItems.map(i => [i.id, i]));

        // Fetch Clients (Optimized Select)
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('id, full_name, status_id, service_type');

        if (clientsError) throw new Error(`Failed to fetch clients: ${clientsError.message}`);
        const clientMap = new Map(clients.map(c => [c.id, c]));

        // Get Max Order Number
        const { data: maxOrderData } = await supabase
            .from('orders')
            .select('order_number')
            .order('order_number', { ascending: false })
            .limit(1)
            .maybeSingle();
        let nextOrderNumber = Math.max(100000, (maxOrderData?.order_number || 0) + 1);

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
                        created_at: currentTime.toISOString(),
                        last_updated: currentTime.toISOString(),
                        notes: notes,
                        case_id: caseId || `CASE-${Date.now()}`
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

        // --- 3. Process FOOD Orders ---
        // --- 3. Process FOOD Orders (Parallelized) ---
        const { data: foodOrders } = await supabase.from('client_food_orders').select('*');
        if (foodOrders) {
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

                        if (targetDayName !== dayName) continue; // Not today's target

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

                        if (isDuplicate) continue;

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
                                        const price = mItem.priceEach || mItem.value || 0;
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
            templateItemsHelper: (t: any) => any
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

            if (count && count > 0) return; // Expected Skip (Weekly Limit)

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
                    template.case_id
                );

                if (newOrder) {
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
                        items: template.items
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
                    template.case_id
                );

                if (newOrder) {
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
                            const price = mItem?.priceEach || mItem?.value || 0;
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

        // Execute Meal/Box Processing (Batched)
        const { data: mealOrders } = await supabase.from('client_meal_orders').select('*');
        if (mealOrders) {
            await processBatch(mealOrders, (mo) => processPeriodicOrder(mo, 'Meal', (t) => null));
        }

        const { data: boxOrders } = await supabase.from('client_box_orders').select('*');
        if (boxOrders) {
            await processBatch(boxOrders, (bo) => processPeriodicOrder(bo, 'Boxes', (t) => ({ vendorId: t.vendor_id })));
        }

        // --- 5. Process CUSTOM Orders (Parallelized) ---
        // console.log('[Unified Scheduling] Starting Custom Order Processing...'); 
        const { data: customOrders } = await supabase.from('upcoming_orders').select('*').eq('service_type', 'Custom');

        if (customOrders) {
            await processBatch(customOrders, async (co) => {
                if (!isClientEligible(co.client_id)) return;

                if (!co.delivery_day) return;

                const { data: vs } = await supabase
                    .from('upcoming_order_vendor_selections')
                    .select('id, vendor_id')
                    .eq('upcoming_order_id', co.id)
                    .single();

                const vendorId = vs?.vendor_id;
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

                if (count && count > 0) return;

                const assignedId = nextOrderNumber++;
                const newOrder = await createOrder(
                    co.client_id,
                    'Custom',
                    deliveryDate,
                    null,
                    vendorId,
                    co.total_value,
                    1,
                    co.notes,
                    co.case_id,
                    assignedId
                );

                if (newOrder) {
                    const { data: newVs } = await supabase.from('order_vendor_selections').insert({
                        order_id: newOrder.id,
                        vendor_id: vendorId
                    }).select().single();

                    if (newVs) {
                        const upcomingVsId = vs?.id;
                        if (upcomingVsId) {
                            const { data: upcomingItems } = await supabase
                                .from('upcoming_order_items')
                                .select('*')
                                .eq('upcoming_order_vendor_selection_id', upcomingVsId);

                            if (upcomingItems && upcomingItems.length > 0) {
                                for (const uItem of upcomingItems) {
                                    const itemName = uItem.custom_name || uItem.notes || 'Custom Item';
                                    const itemPrice = uItem.custom_price || uItem.total_value || 0;

                                    await supabase.from('order_items').insert({
                                        order_id: newOrder.id,
                                        vendor_selection_id: newVs.id,
                                        menu_item_id: null,
                                        custom_name: itemName,
                                        custom_price: itemPrice,
                                        quantity: uItem.quantity || 1,
                                        unit_value: itemPrice,
                                        total_value: (itemPrice * (uItem.quantity || 1)),
                                        notes: uItem.notes
                                    });
                                }
                            } else {
                                const rawItemName = co.custom_name || co.notes || 'Custom Item';
                                const itemNames = rawItemName.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);

                                if (itemNames.length > 0) {
                                    const totalOrderValue = co.total_value || 0;
                                    const pricePerItem = totalOrderValue / itemNames.length;

                                    for (const name of itemNames) {
                                        await supabase.from('order_items').insert({
                                            order_id: newOrder.id,
                                            vendor_selection_id: newVs.id,
                                            menu_item_id: null,
                                            custom_name: name,
                                            custom_price: pricePerItem,
                                            quantity: 1,
                                            unit_value: pricePerItem,
                                            total_value: pricePerItem,
                                            notes: null
                                        });
                                    }
                                } else {
                                    await supabase.from('order_items').insert({
                                        order_id: newOrder.id,
                                        vendor_selection_id: newVs.id,
                                        menu_item_id: null,
                                        custom_name: 'Custom Item',
                                        custom_price: co.total_value,
                                        quantity: 1,
                                        unit_value: co.total_value,
                                        total_value: co.total_value,
                                        notes: co.notes
                                    });
                                }
                            }
                        }
                    }
                }
            });
        } else {
            // console.log('[Custom Debug] No custom orders passed filter.');
        }

        // --- 6. Send Report ---
        console.log('[Unified Scheduling] Complete. Sending report...');
        const emailResult = await sendSchedulingReport(report, reportEmail);

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
