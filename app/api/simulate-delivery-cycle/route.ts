import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentTime } from '@/lib/time';
import {
    getMenuItems,
    getVendors,
    getStatuses,
    getMealItems,
    getEquipment
} from '@/lib/actions';
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

/**
 * UNIFIED ORDER SCHEDULING API
 * Authoritative Implementation
 * 
 * Rules:
 * 1. Single API for all recurring orders (Food, Meal, Box, Custom).
 * 2. Strict Whole Day Cutoffs (days_until == cutoff).
 * 3. Strict Inclusion/Exclusion (Client Status, Equipment excluded).
 * 4. Reporting is mandatory.
 */
export async function POST(request: NextRequest) {
    console.log('[Unified Scheduling] Starting execution...');

    // --- 0. Setup Reporting ---
    const report = {
        totalCreated: 0,
        breakdown: {
            Food: 0,
            Meal: 0,
            Boxes: 0,
            Custom: 0
        },
        unexpectedFailures: [] as { clientName: string, orderType: string, date: string, reason: string }[]
    };

    function logUnexpected(clientName: string, type: string, date: string, reason: string) {
        console.error(`[Unexpected Failure] ${clientName} | ${type} | ${reason}`);
        report.unexpectedFailures.push({ clientName, orderType: type, date, reason });
    }

    try {
        // --- 1. Load Global Context ---
        const currentTime = await getCurrentTime(); // Source of truth for time
        const today = new Date(currentTime);
        today.setHours(0, 0, 0, 0); // Normalized Today (Start of Day)

        // Fetch Reference Data
        const [
            allVendors,
            allStatuses,
            allMenuItems,
            allMealItems
        ] = await Promise.all([
            getVendors(),
            getStatuses(),
            getMenuItems(),
            getMealItems()
        ]);

        // Get Settings for Report Email
        const { data: settingsData } = await supabase.from('app_settings').select('*').single();
        const settings = settingsData as AppSettings;
        const reportEmail = settings?.reportEmail || 'admin@example.com'; // Fallback if not set

        // Map Helpers
        const statusMap = new Map(allStatuses.map(s => [s.id, s]));
        const vendorMap = new Map(allVendors.map(v => [v.id, v]));

        // Fetch All Clients (for status check)
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('id, full_name, status_id, service_type');

        if (clientsError) throw new Error(`Failed to fetch clients: ${clientsError.message}`);

        const clientMap = new Map(clients.map(c => [c.id, c]));

        // Get Max Order Number for ID generation
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
            caseId?: string
        ) {
            try {
                // Formatting Date
                const deliveryDateStr = deliveryDate.toISOString().split('T')[0];

                // Insert Order
                const { data: newOrder, error: orderErr } = await supabase
                    .from('orders')
                    .insert({
                        client_id: clientId,
                        service_type: serviceType,
                        status: 'scheduled', // Initial status
                        scheduled_delivery_date: deliveryDateStr,
                        total_value: totalValue,
                        total_items: totalItems,
                        order_number: nextOrderNumber,
                        created_at: currentTime.toISOString(),
                        last_updated: currentTime.toISOString(),
                        notes: notes,
                        case_id: caseId || `CASE-${Date.now()}`
                    })
                    .select()
                    .single();

                if (orderErr) throw orderErr;

                nextOrderNumber++; // Increment locally

                // Track Stats
                report.totalCreated++;
                if (serviceType === 'Food') report.breakdown.Food++;
                if (serviceType === 'Meal') report.breakdown.Meal++;
                if (serviceType === 'Boxes') report.breakdown.Boxes++;
                if (serviceType === 'Custom') report.breakdown.Custom++;

                return newOrder;
            } catch (err: any) {
                const client = clientMap.get(clientId);
                logUnexpected(client?.full_name || clientId, serviceType, deliveryDate.toISOString(), `Create Order Failed: ${err.message}`);
                return null;
            }
        }

        // --- 3. Process FOOD Orders ---
        // "Strict Single-Day Window"
        const { data: foodOrders } = await supabase.from('client_food_orders').select('*');
        if (foodOrders) {
            for (const fo of foodOrders) {
                if (!isClientEligible(fo.client_id)) continue; // Expected Skip
                const client = clientMap.get(fo.client_id);
                if (client?.service_type !== 'Food') continue; // Enforce Order Type

                const dayOrders = typeof fo.delivery_day_orders === 'string'
                    ? JSON.parse(fo.delivery_day_orders)
                    : fo.delivery_day_orders;

                if (!dayOrders) continue;

                for (const dayName of Object.keys(dayOrders)) {
                    // Check Logic: For this configured day "Monday", finds the specific Date D.
                    // But wait, the date D logic depends on the VENDOR cutoff.
                    // The spec says: "For each delivery date D... created ONLY if days_until == cutoff".
                    // But D is derived from "Weekday" + "Vendor".

                    // So first, we identify the potential Delivery Date for this configuration.
                    // Since specific day is configured (e.g. Wednesday), we check if the UPCOMING Wednesday matches the cutoff.

                    const vendorSelections = dayOrders[dayName].vendorSelections || [];
                    for (const sel of vendorSelections) {
                        if (!sel.vendorId) continue;
                        const vendor = vendorMap.get(sel.vendorId);
                        if (!vendor) continue;

                        // 1. Calculate Target Delivery Date
                        // We use the helper to find the NEXT valid date for this day.
                        // However, we must ensure we don't accidentally "jump" a week if we are looking for "Today" or "Tomorrow" depending on cutoff.
                        // Actually, we iterate through reasonable upcoming dates?
                        // No. The spec says "For each delivery date D...".
                        // A recurrence means D occurs every week.
                        // We basically check: Is the *Next Occurrence* of DayName at exactly Cutoff distance?

                        // We need the date that is 'cutoffDays' away from today.
                        // If Today+Cutoff is a Monday, and Client configured Monday -> Match.

                        const cutoff = vendor.cutoffDays || 0;
                        const targetDate = new Date(today);
                        targetDate.setDate(today.getDate() + cutoff);
                        const targetDayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' });

                        // Does client have an order configured for this Target Day?
                        if (targetDayName !== dayName) continue; // Not the day we are processing loop-wise, but wait.
                        // The loop iterates configured days. 
                        // If configured day is "Wednesday", and Today+Cutoff is "Wednesday", we proceed.

                        // Calculate specific date D
                        const deliveryDate = targetDate; // This IS the date D

                        // STRICT RULE: days_until == cutoff.
                        // By definition, deliveryDate is Today + Cutoff. So this is satisfied.

                        // Duplication Check (Strict Client + Vendor + Date)
                        const { count } = await supabase
                            .from('orders')
                            .select('*', { count: 'exact', head: true })
                            .eq('client_id', fo.client_id)
                            .eq('scheduled_delivery_date', deliveryDate.toISOString().split('T')[0])
                            .eq('service_type', 'Food');

                        // Wait, spec says "Client + Vendor + Delivery Date". 
                        // Existing 'orders' check above is only Client + Date + Type.
                        // Existing logic checks vendor selections inside.
                        // We need to check order_vendor_selections.

                        let isDuplicate = false;
                        if (count && count > 0) {
                            // Fetch the actual orders to check vendor
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

                        if (isDuplicate) continue; // Expected Skip (Duplicate)

                        // --- Create Food Order ---
                        // Prepare Items
                        let itemsTotal = 0;
                        let valueTotal = 0;
                        const itemsList = [];

                        if (sel.items) {
                            for (const [itemId, qty] of Object.entries(sel.items)) {
                                const q = Number(qty);
                                if (q > 0) {
                                    const mItem = allMenuItems.find(i => i.id === itemId) || allMealItems.find(i => i.id === itemId);
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

                        if (itemsList.length === 0) continue; // Skip empty

                        const newOrder = await createOrder(
                            fo.client_id,
                            'Food',
                            deliveryDate,
                            null,
                            null,
                            valueTotal,
                            itemsTotal,
                            null,
                            fo.case_id
                        );

                        if (newOrder) {
                            // Add Vendor Selection
                            const { data: vs } = await supabase.from('order_vendor_selections').insert({
                                order_id: newOrder.id,
                                vendor_id: sel.vendorId
                            }).select().single();

                            if (vs) {
                                // Add Items
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
            }
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
                    null,
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
                    null,
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

        // Execute Meal/Box Processing
        const { data: mealOrders } = await supabase.from('client_meal_orders').select('*');
        if (mealOrders) {
            for (const mo of mealOrders) {
                await processPeriodicOrder(mo, 'Meal', (t) => null);
            }
        }

        const { data: boxOrders } = await supabase.from('client_box_orders').select('*');
        if (boxOrders) {
            for (const bo of boxOrders) {
                await processPeriodicOrder(bo, 'Boxes', (t) => ({ vendorId: t.vendor_id }));
            }
        }

        // --- 5. Process CUSTOM Orders ---
        // "Created ONLY on the exact cutoff day"
        // "One per week... First valid wins"
        console.log('[Unified Scheduling] Starting Custom Order Processing...');
        const { data: customOrders } = await supabase.from('upcoming_orders').select('*').eq('service_type', 'Custom');

        if (customOrders) {
            console.log(`[Custom Debug] Found ${customOrders.length} custom order candidates.`);
            for (const co of customOrders) {
                console.log(`[Custom Debug] Processing candidate ${co.id} for client ${co.client_id}`);

                if (!isClientEligible(co.client_id)) {
                    console.log(`[Custom Debug] Client ${co.client_id} is not eligible. Skipping.`);
                    continue;
                }

                // Validate Delivery Day Config
                if (!co.delivery_day) {
                    logUnexpected(clientMap.get(co.client_id)?.full_name || co.client_id, 'Custom', 'N/A', 'Missing delivery_day configuration');
                    console.log(`[Custom Debug] Missing delivery_day for ${co.id}. Skipping.`);
                    continue;
                }

                // Identify Cutoff
                const { data: vs } = await supabase
                    .from('upcoming_order_vendor_selections')
                    .select('id, vendor_id')
                    .eq('upcoming_order_id', co.id)
                    .single();

                const vendorId = vs?.vendor_id;
                if (!vendorId) {
                    // No vendor = cannot determine cutoff. Spec says "Custom orders have: A vendor".
                    console.log(`[Custom Debug] No vendor found for ${co.id}. Skipping.`);
                    continue;
                }
                const vendor = vendorMap.get(vendorId);
                const cutoff = vendor?.cutoffDays || 0;
                console.log(`[Custom Debug] Vendor ${vendorId} found. Cutoff: ${cutoff} days.`);

                // Target Date Calc:
                const targetDate = new Date(today);
                targetDate.setDate(today.getDate() + cutoff);
                const targetDayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' });

                console.log(`[Custom Debug] Target Day for Cutoff is ${targetDayName} (${targetDate.toISOString().split('T')[0]}). Configured Day: ${co.delivery_day}`);

                if (targetDayName !== co.delivery_day) {
                    console.log(`[Custom Debug] Day mismatch. Skipping.`);
                    continue; // Not the cutoff day
                }

                // EXACT MATCH -> Proceed
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
                    console.log(`[Custom Debug] Weekly limit reached for client ${co.client_id}. Skipping.`);
                    continue; // Blocked (Limit Reached)
                }

                console.log(`[Custom Debug] Creating order for client ${co.client_id} on ${deliveryDate.toISOString()}`);

                // Create Custom Order
                const newOrder = await createOrder(
                    co.client_id,
                    'Custom',
                    deliveryDate,
                    null,
                    vendorId,
                    co.total_value,
                    1,
                    co.notes,
                    co.case_id
                );

                if (newOrder) {
                    console.log(`[Custom Debug] Order ${newOrder.id} created successfully.`);

                    // Link Vendor
                    const { data: newVs } = await supabase.from('order_vendor_selections').insert({
                        order_id: newOrder.id,
                        vendor_id: vendorId
                    }).select().single();

                    if (newVs) {
                        console.log(`[Custom Debug] Vendor selection ${newVs.id} created.`);

                        const upcomingVsId = vs?.id; // 'vs' is from line 623

                        if (upcomingVsId) {
                            const { data: upcomingItems } = await supabase
                                .from('upcoming_order_items')
                                .select('*')
                                .eq('upcoming_order_vendor_selection_id', upcomingVsId);

                            console.log(`[Custom Debug] Found ${upcomingItems?.length || 0} items in upcoming_order_items for VS ${upcomingVsId}`);

                            if (upcomingItems && upcomingItems.length > 0) {
                                for (const uItem of upcomingItems) {
                                    // Use custom_name if available, else usage notes as name?
                                    // Often custom order item name is just the note.

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
                                        notes: uItem.notes // Keep note in notes too
                                    });
                                }
                                console.log(`[Custom Debug] Items transferred.`);
                            } else {
                                console.log(`[Custom Debug] No items found, creating fallback item from order details.`);
                                // Use co.notes as name if available, as that's where the user text is
                                const rawItemName = co.custom_name || co.notes || 'Custom Item';

                                // Split by comma to support multiple items
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
                                            notes: null // Don't duplicate the full list into the notes of each item
                                        });
                                    }
                                } else {
                                    // Fallback if split results in empty (shouldn't happen with default)
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
                    } else {
                        console.error(`[Custom Debug] Failed to create order_vendor_selections for order ${newOrder.id}`);
                    }
                } else {
                    console.error(`[Custom Debug] Failed to create order shell.`);
                }
            }
        } else {
            console.log('[Custom Debug] No custom orders passed filter.');
        }

        // --- 6. Send Report ---
        console.log('[Unified Scheduling] Complete. Sending report...');
        await sendSchedulingReport(report, reportEmail);

        return NextResponse.json({
            success: true,
            report
        });

    } catch (error: any) {
        console.error('[Unified Scheduling] Critical Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
