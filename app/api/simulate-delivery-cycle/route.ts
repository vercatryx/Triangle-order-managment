import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentTime } from '@/lib/time';
import { getMenuItems, getSettings, getVendors, getStatuses, getMealItems } from '@/lib/actions';
import { getNextDeliveryDateForDay } from '@/lib/order-dates';

// Initialize Supabase Admin Client to bypass RLS
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * API Route: Simulate Delivery Cycle
 * 
 * POST /api/simulate-delivery-cycle
 * 
 * Logic:
 * 1. Find ALL Upcoming Orders with status 'scheduled' (no date filtering - they are templates).
 * 2. For each match:
 *    - Calculate the actual delivery date from delivery_day (day of week).
 *    - Create a new Order in 'orders' table with the calculated delivery date.
 *    - Status = 'waiting_for_proof'.
 *    - Maintain link to Client (client_id).
 *    - Copy all vendor selections/items/boxes.
 * 3. Do NOT modify the original Upcoming Order (it remains as a template).
 */
export async function POST(request: NextRequest) {
    try {
        console.log('[Simulate Delivery] Starting new simulation logic with split tables...');
        const errors: string[] = [];
        const skippedReasons: string[] = [];
        const debugLogs: string[] = [];
        let processedCount = 0;
        let skippedCount = 0;
        let ineligibleCount = 0;

        // Fetch reference data
        const menuItems = await getMenuItems();
        const mealItems = await getMealItems();
        const statuses = await getStatuses();
        const vendors = await getVendors();
        const statusMap = new Map(statuses.map(s => [s.id, s.deliveriesAllowed]));
        debugLogs.push(`Loaded ${menuItems.length} menu items, ${mealItems.length} meal items, ${statuses.length} statuses, ${vendors.length} vendors`);

        // Fetch all clients to check status
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('id, status_id, created_at, service_type');

        if (clientsError) throw new Error(`Failed to fetch clients: ${clientsError.message}`);
        const clientMap = new Map(clients.map(c => [c.id, c]));

        // --- 1. Fetch Templates from New Tables ---

        // A. Food Orders
        const { data: foodOrders, error: foodError } = await supabase
            .from('client_food_orders')
            .select('*');
        if (foodError) errors.push(`Error fetching food orders: ${foodError.message}`);

        // B. Box Orders
        const { data: boxOrders, error: boxError } = await supabase
            .from('client_box_orders')
            .select('*');
        if (boxError) errors.push(`Error fetching box orders: ${boxError.message}`);

        // C. Meal Orders
        const { data: mealOrders, error: mealError } = await supabase
            .from('client_meal_orders')
            .select('*');
        if (mealError) errors.push(`Error fetching meal orders: ${mealError.message}`);

        console.log(`[Simulate Delivery] Found ${foodOrders?.length || 0} food templates, ${boxOrders?.length || 0} box templates, ${mealOrders?.length || 0} meal templates`);

        // --- 2. Flatten Candidates ---
        interface CandidateOrder {
            clientId: string;
            serviceType: 'Food' | 'Boxes' | 'Meal';
            deliveryDay: string; // "Monday", etc.
            sourceRef: any; // The original record or specific config
            isBox?: boolean;
            isFood?: boolean;
            isMeal?: boolean;
            vendorId?: string; // For Meal/Box where strictly defined
            caseId?: string;
        }

        const candidates: CandidateOrder[] = [];

        // Flatten Food Orders
        if (foodOrders) {
            for (const fo of foodOrders) {
                const client = clientMap.get(fo.client_id);
                // Only process if client exists and matches service type (sanity check)
                if (!client) continue;

                // Parse delivery_day_orders JSON
                const dayOrders = typeof fo.delivery_day_orders === 'string'
                    ? JSON.parse(fo.delivery_day_orders)
                    : fo.delivery_day_orders;

                if (dayOrders) {
                    for (const day of Object.keys(dayOrders)) {
                        if (!day || day === 'null') continue;

                        candidates.push({
                            clientId: fo.client_id,
                            serviceType: 'Food',
                            deliveryDay: day,
                            sourceRef: dayOrders[day],
                            isFood: true,
                            caseId: fo.case_id
                        });
                    }
                }
            }
        }

        // Flatten Box Orders
        if (boxOrders) {
            for (const bo of boxOrders) {
                const client = clientMap.get(bo.client_id);
                if (!client) continue;

                if (!bo.vendor_id) continue;

                const vendor = vendors.find(v => v.id === bo.vendor_id);
                if (!vendor) continue;

                const vDays: string[] = (vendor as any).delivery_days || (vendor as any).deliveryDays || [];
                if (vDays.length === 0) continue;

                const weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const selectedDay = weekDays.find(day => vDays.includes(day));

                if (!selectedDay) continue;

                candidates.push({
                    clientId: bo.client_id,
                    serviceType: 'Boxes',
                    deliveryDay: selectedDay,
                    sourceRef: bo,
                    isBox: true,
                    vendorId: bo.vendor_id,
                    caseId: bo.case_id
                });
            }
        }

        // Flatten Meal Orders
        if (mealOrders) {
            for (const mo of mealOrders) {
                const client = clientMap.get(mo.client_id);
                if (!client) continue;

                const selections = typeof mo.meal_selections === 'string'
                    ? JSON.parse(mo.meal_selections)
                    : mo.meal_selections;

                if (!selections) continue;

                // Group by Day -> Vendor -> Items
                // We want to verify duplicate items logic? 
                // If Breakfast has Item A x 2, and Lunch has Item A x 1. Total x 3.
                // We need to merge items if same vendor/day.

                const dayGroups = new Map<string, Map<string, { items: Record<string, number>, itemNotes: Record<string, string> }>>(); // Day -> VendorId -> { items, itemNotes }

                for (const [mealType, config] of Object.entries(selections)) {
                    const c = config as any;
                    if (!c.vendorId) continue; // Logic: No Vendor = Skip

                    const vendor = vendors.find(v => v.id === c.vendorId);
                    if (!vendor) continue;

                    // Logic: Vendor Exists = First day of week
                    const vDays: string[] = (vendor as any).delivery_days || (vendor as any).deliveryDays || [];
                    if (vDays.length === 0) continue;

                    const weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                    const selectedDay = weekDays.find(day => vDays.includes(day));

                    if (!selectedDay) continue;

                    if (!dayGroups.has(selectedDay)) {
                        dayGroups.set(selectedDay, new Map());
                    }
                    const vendorMap = dayGroups.get(selectedDay)!;

                    if (!vendorMap.has(c.vendorId)) {
                        vendorMap.set(c.vendorId, { items: {}, itemNotes: {} });
                    }
                    const entry = vendorMap.get(c.vendorId)!;

                    // Merge items
                    if (c.items) {
                        for (const [itemId, qty] of Object.entries(c.items)) {
                            const q = Number(qty) || 0;
                            entry.items[itemId] = (entry.items[itemId] || 0) + q;

                            // Merge notes (if any)
                            if (c.itemNotes && c.itemNotes[itemId]) {
                                const newNote = c.itemNotes[itemId];
                                if (entry.itemNotes[itemId]) {
                                    entry.itemNotes[itemId] += `; ${newNote}`;
                                } else {
                                    entry.itemNotes[itemId] = newNote;
                                }
                            }
                        }
                    }
                }

                // Create candidates from groups
                for (const [day, vendorMap] of dayGroups.entries()) {
                    const combinedVendorSelections = [];
                    for (const [vId, data] of vendorMap.entries()) {
                        combinedVendorSelections.push({
                            vendorId: vId,
                            items: data.items,
                            itemNotes: data.itemNotes
                        });
                    }

                    if (combinedVendorSelections.length > 0) {
                        candidates.push({
                            clientId: mo.client_id,
                            serviceType: 'Meal',
                            deliveryDay: day,
                            sourceRef: { vendorSelections: combinedVendorSelections },
                            isMeal: true,
                            caseId: mo.case_id
                        });
                    }
                }
            }
        }

        console.log(`[Simulate Delivery] Generated ${candidates.length} candidate orders for processing`);

        // --- 3. Process Candidates ---

        // Get max order number
        const { data: maxOrderData } = await supabase
            .from('orders')
            .select('order_number')
            .order('order_number', { ascending: false })
            .limit(1)
            .maybeSingle();
        let nextOrderNumber = Math.max(100000, (maxOrderData?.order_number || 0) + 1);

        const { getNextOccurrence } = await import('@/lib/order-dates');
        const currentTime = await getCurrentTime();

        const skippedReasonsMap: Record<string, number> = {};

        function trackSkip(reason: string, details?: string) {
            skippedCount++;
            skippedReasonsMap[reason] = (skippedReasonsMap[reason] || 0) + 1;
            if (details) skippedReasons.push(`${reason}: ${details}`);
        }

        for (const candidate of candidates) {
            const client = clientMap.get(candidate.clientId);

            // Check Eligibility
            if (client) {
                const isAllowed = statusMap.get(client.status_id);
                if (isAllowed === false) {
                    ineligibleCount++;
                    trackSkip('Ineligible Status', `Client ${candidate.clientId} status ineligible`);
                    continue;
                }
            }

            // Calculate Delivery Date
            const nextDeliveryDate = getNextOccurrence(candidate.deliveryDay, currentTime);
            if (!nextDeliveryDate) {
                trackSkip('Invalid Delivery Day', `Client ${candidate.clientId} has invalid day ${candidate.deliveryDay}`);
                continue;
            }

            const timeRemainingMs = nextDeliveryDate.getTime() - currentTime.getTime();
            const timeRemainingHours = timeRemainingMs / (1000 * 60 * 60);
            const deliveryDateStr = nextDeliveryDate.toISOString().split('T')[0];

            // Determine Cutoff (Max of vendors involved)
            let maxCutoffHours = 0;
            let hasValidVendor = false;

            if (candidate.isFood || candidate.isMeal) {
                // Parse vendor selections from the day config
                const dayConfig = candidate.sourceRef;
                const vSelections = dayConfig.vendorSelections || [];

                for (const sel of vSelections) {
                    if (sel.vendorId) {
                        const vendor = vendors.find(v => v.id === sel.vendorId);
                        if (vendor) {
                            hasValidVendor = true;
                            if ((vendor.cutoffHours || 0) > maxCutoffHours) maxCutoffHours = vendor.cutoffHours || 0;
                        }
                    }
                }
            } else if (candidate.isBox) {
                const bo = candidate.sourceRef;
                if (bo.vendor_id) {
                    const vendor = vendors.find(v => v.id === bo.vendor_id);
                    if (vendor) {
                        hasValidVendor = true;
                        if ((vendor.cutoffHours || 0) > maxCutoffHours) maxCutoffHours = vendor.cutoffHours || 0;
                    }
                }
            }

            if (!hasValidVendor) {
                trackSkip('No Valid Vendor', `Client ${candidate.clientId} (${candidate.serviceType})`);
                continue;
            }

            // Client Age Check
            if (client && client.created_at) {
                const clientAgeMs = currentTime.getTime() - new Date(client.created_at).getTime();
                const clientAgeHours = clientAgeMs / (1000 * 60 * 60);
                if (clientAgeHours < maxCutoffHours) {
                    trackSkip('Client Account Too New', `Client ${candidate.clientId} created ${Math.floor(clientAgeHours)}h ago (Needs ${maxCutoffHours}h)`);
                    continue;
                }
            }

            // JIT Check
            if (timeRemainingHours > maxCutoffHours) {
                // Too early
                // console.log(`[JIT] Skipping ${candidate.clientId} for ${deliveryDateStr}. Too early.`);
                trackSkip('Waiting for Cutoff', `Client ${candidate.clientId} delivery ${deliveryDateStr}`);
                continue;
            }

            // --- Create Order ---

            // Food & Meal Order Creation (Unified Logic)
            if (candidate.isFood || candidate.isMeal) {
                const dayConfig = candidate.sourceRef;
                const vSelections = dayConfig.vendorSelections || [];

                for (const vs of vSelections) {
                    if (!vs.vendorId) continue;

                    // CHECK DUPLICATES
                    let exists = false;

                    if (candidate.isMeal) {
                        // Weekly Limit for Meals
                        const deliveryDate = new Date(deliveryDateStr);
                        const dayOfWeek = deliveryDate.getUTCDay();
                        const startOfWeek = new Date(deliveryDate);
                        startOfWeek.setDate(deliveryDate.getDate() - dayOfWeek);
                        const endOfWeek = new Date(deliveryDate);
                        endOfWeek.setDate(deliveryDate.getDate() + (6 - dayOfWeek));

                        const startOfWeekStr = startOfWeek.toISOString().split('T')[0];
                        const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

                        const { count } = await supabase
                            .from('orders')
                            .select('*', { count: 'exact', head: true })
                            .eq('client_id', candidate.clientId)
                            .gte('scheduled_delivery_date', startOfWeekStr)
                            .lte('scheduled_delivery_date', endOfWeekStr)
                            .eq('service_type', candidate.serviceType); // 'Meal'

                        if (count && count > 0) {
                            trackSkip('Weekly Limit Reached', `Client ${candidate.clientId} Meal already ordered for week ${startOfWeekStr}`);
                            continue;
                        }
                    } else {
                        // Daily/Vendor Check for Food
                        const { data: existingOrders } = await supabase
                            .from('orders')
                            .select('id')
                            .eq('client_id', candidate.clientId)
                            .eq('scheduled_delivery_date', deliveryDateStr)
                            .eq('service_type', candidate.serviceType); // Dynamic Service Type

                        // Check if this specific vendor already exists in those orders
                        if (existingOrders && existingOrders.length > 0) {
                            const { data: exVs } = await supabase
                                .from('order_vendor_selections')
                                .select('id')
                                .in('order_id', existingOrders.map(o => o.id))
                                .eq('vendor_id', vs.vendorId)
                                .maybeSingle();
                            if (exVs) exists = true;
                        }

                        if (exists) {
                            trackSkip('Order Already Exists', `Client ${candidate.clientId} ${deliveryDateStr} Vendor ${vs.vendorId}`);
                            continue;
                        }
                    }

                    // Prepare Items & Calc Total
                    let vendorTotal = 0;
                    let totalItems = 0;
                    const itemsToInsert: any[] = [];

                    // vs.items is likely { itemId: qty }
                    if (vs.items) {
                        for (const [itemId, qty] of Object.entries(vs.items)) {
                            const quantity = Number(qty);
                            if (quantity > 0) {
                                // Debug Item Notes
                                if (vs.itemNotes && vs.itemNotes[itemId]) {
                                    const msg = `[Simulate] Found note for item ${itemId}: "${vs.itemNotes[itemId]}"`;
                                    console.log(msg);
                                    debugLogs.push(msg);
                                }

                                let menuItem: any = menuItems.find(mi => mi.id === itemId);
                                if (!menuItem) {
                                    menuItem = mealItems.find(mi => mi.id === itemId);
                                }
                                const price = menuItem?.priceEach ?? menuItem?.value ?? 0;
                                const lineTotal = price * quantity;

                                vendorTotal += lineTotal;
                                totalItems += quantity;

                                const note = vs.itemNotes ? vs.itemNotes[itemId] : null;
                                if (note) {
                                    const msg = `[Simulate] Attaching note to insert payload: "${note}"`;
                                    console.log(msg);
                                    debugLogs.push(msg);
                                }

                                itemsToInsert.push({
                                    menu_item_id: itemId,
                                    quantity: quantity,
                                    unit_value: price,
                                    total_value: lineTotal,
                                    notes: note
                                });
                            }
                        }
                    }

                    if (itemsToInsert.length === 0) {
                        trackSkip('Empty Order Config', `Client ${candidate.clientId} has 0 items`);
                        continue;
                    }

                    // Insert Order
                    const { data: newOrder, error: orderErr } = await supabase
                        .from('orders')
                        .insert({
                            client_id: candidate.clientId,
                            service_type: candidate.serviceType,
                            case_id: candidate.caseId || `CASE-${Date.now()}`, // fallback if missing (shouldn't be)
                            status: 'scheduled',
                            scheduled_delivery_date: deliveryDateStr,
                            total_value: vendorTotal,
                            total_items: totalItems,
                            order_number: nextOrderNumber,
                            created_at: currentTime.toISOString(),
                            last_updated: currentTime.toISOString()
                        })
                        .select()
                        .single();

                    if (orderErr) {
                        console.error(`[Create Error] Failed to insert order for ${candidate.clientId}:`, orderErr);
                        errors.push(`Failed to create order for ${candidate.clientId}: ${orderErr.message}`);
                        continue;
                    }
                    if (!newOrder) {
                        console.error(`[Create Error] Order inserted but returned null?? RLS? Client: ${candidate.clientId}`);
                        errors.push(`Failed to retrieve created order for ${candidate.clientId} - RLS?`);
                        continue;
                    }

                    // Insert Vendor Selection
                    const { data: newVs, error: vsErr } = await supabase
                        .from('order_vendor_selections')
                        .insert({
                            order_id: newOrder.id,
                            vendor_id: vs.vendorId
                        })
                        .select()
                        .single();

                    if (vsErr || !newVs) {
                        // Rollback? or log error
                        errors.push(`Failed VS for ${newOrder.id}`);
                        continue;
                    }

                    // Insert Items
                    const itemsWithIds = itemsToInsert.map(i => ({
                        // Ensure we only send expected columns. 
                        // Check strictly what cols we have.
                        menu_item_id: i.menu_item_id,
                        quantity: i.quantity,
                        unit_value: i.unit_value,
                        total_value: i.total_value,
                        vendor_selection_id: newVs.id,
                        order_id: newOrder.id, // Re-added: Required by schema
                        notes: i.notes
                    }));

                    // console.log(`[Debug] Inserting items for order ${newOrder.id}:`, JSON.stringify(itemsWithIds));

                    const { error: itemsErr } = await supabase.from('order_items').insert(itemsWithIds);
                    if (itemsErr) {
                        console.error(`[Create Error] Failed to insert items for Order ${newOrder.id} (VS ${newVs.id}):`, itemsErr);
                        errors.push(`Failed items for Order ${newOrder.id}: ${itemsErr.message} (Code: ${itemsErr.code})`);
                    } else {
                        // console.log(`[Success] Inserted ${itemsWithIds.length} items for Order ${newOrder.id}`);
                    }

                    console.log(`[Created] ${candidate.serviceType} Order #${nextOrderNumber} for ${candidate.clientId}`);
                    nextOrderNumber++;
                    processedCount++;
                }

            } else if (candidate.isBox) {
                // Weekly Frequency Check for Boxes
                // Logic: One box order per week per client.
                const deliveryDate = new Date(deliveryDateStr);
                const dayOfWeek = deliveryDate.getUTCDay(); // 0 (Sun) - 6 (Sat)
                const startOfWeek = new Date(deliveryDate);
                startOfWeek.setDate(deliveryDate.getDate() - dayOfWeek);
                const endOfWeek = new Date(deliveryDate);
                endOfWeek.setDate(deliveryDate.getDate() + (6 - dayOfWeek));

                const startOfWeekStr = startOfWeek.toISOString().split('T')[0];
                const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

                const { count } = await supabase
                    .from('orders')
                    .select('*', { count: 'exact', head: true })
                    .eq('client_id', candidate.clientId)
                    .gte('scheduled_delivery_date', startOfWeekStr)
                    .lte('scheduled_delivery_date', endOfWeekStr)
                    .eq('service_type', 'Boxes');

                if (count && count > 0) {
                    trackSkip('Weekly Limit Reached', `Client ${candidate.clientId} Boxes already ordered for week ${startOfWeekStr}`);
                    continue;
                }

                const bo = candidate.sourceRef;
                // Calculate Value: Assuming items key exists in box order { itemId: qty }
                let boxTotal = 0;
                const itemsToInsert: any[] = [];
                // bo.items is { itemId: qty }
                if (bo.items) {
                    for (const [itemId, qty] of Object.entries(bo.items)) {
                        const quantity = Number(qty);
                        if (quantity > 0) {
                            const menuItem = menuItems.find(mi => mi.id === itemId);
                            const price = menuItem?.priceEach ?? menuItem?.value ?? 0;
                            // For boxes, value logic might be quota based, but price is price.
                            boxTotal += price * quantity;
                        }
                    }
                }
                // Mulitply by quantity of boxes?
                const totalBoxValue = boxTotal * (bo.quantity || 1);

                // Insert Order
                const { data: newOrder, error: orderErr } = await supabase
                    .from('orders')
                    .insert({
                        client_id: candidate.clientId,
                        service_type: 'Boxes',
                        case_id: candidate.caseId || `CASE-${Date.now()}`,
                        status: 'scheduled',
                        scheduled_delivery_date: deliveryDateStr,
                        total_value: totalBoxValue,
                        total_items: bo.quantity || 1, // Store box count as items? or sum of contents? Usually box count
                        order_number: nextOrderNumber,
                        created_at: currentTime.toISOString(),
                        last_updated: currentTime.toISOString()
                    })
                    .select()
                    .single();

                if (orderErr) {
                    console.error(`[Create Error] Failed to insert order for ${candidate.clientId}:`, orderErr);
                    errors.push(`Failed to create order for ${candidate.clientId}: ${orderErr.message}`);
                    continue;
                }
                if (!newOrder) {
                    console.error(`[Create Error] Order inserted but returned null?? RLS? Client: ${candidate.clientId}`);
                    errors.push(`Failed to retrieve created order for ${candidate.clientId} - RLS?`);
                    continue;
                }

                // Insert Box Selection
                // We need to insert into order_box_selections
                const { error: boxSelErr } = await supabase
                    .from('order_box_selections')
                    .insert({
                        order_id: newOrder.id,
                        vendor_id: bo.vendor_id,
                        box_type_id: bo.box_type_id,
                        quantity: bo.quantity,
                        unit_value: boxTotal,
                        total_value: totalBoxValue,
                        items: bo.items
                    });

                if (boxSelErr) errors.push(`Failed Box Sel for ${newOrder.id}: ${boxSelErr.message}`);

                console.log(`[Created] Box Order #${nextOrderNumber} for ${candidate.clientId}`);
                nextOrderNumber++;
                processedCount++;
            }
        }

        return NextResponse.json({
            success: true,
            message: `Simulation complete. Processed ${processedCount} candidates. Created ${processedCount - skippedCount} orders. Skipped ${skippedCount}.`,
            createdCount: processedCount - skippedCount,
            totalFound: candidates.length,
            processedCount,
            skippedCount,
            ineligibleCount,
            errors: errors.length ? errors : undefined,
            skippedReasons: skippedReasons.length ? skippedReasons : undefined,
            skippedReasonCounts: skippedReasonsMap, // Grouped counts
            debugLogs: debugLogs.length ? debugLogs : undefined
        });

    } catch (e: any) {
        console.error('Simulate error:', e);
        return NextResponse.json({ success: false, message: e.message }, { status: 500 });
    }
}

