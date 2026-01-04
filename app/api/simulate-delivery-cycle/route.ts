import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getCurrentTime } from '@/lib/time';
import { getMenuItems } from '@/lib/actions';

/**
 * Calculate the next occurrence of a day of week
 * Returns a Date object for the next occurrence of the specified day
 */
async function calculateNextDeliveryDate(deliveryDay: string | null): Promise<Date | null> {
    if (!deliveryDay) return null;

    const today = await getCurrentTime();
    today.setHours(0, 0, 0, 0);

    const dayNameToNumber: { [key: string]: number } = {
        'Sunday': 0,
        'Monday': 1,
        'Tuesday': 2,
        'Wednesday': 3,
        'Thursday': 4,
        'Friday': 5,
        'Saturday': 6
    };

    const targetDayNumber = dayNameToNumber[deliveryDay];
    if (targetDayNumber === undefined) return null;

    // Find the next occurrence of this day (always in the future, never today or past)
    for (let i = 1; i <= 14; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        if (checkDate.getDay() === targetDayNumber) {
            return checkDate;
        }
    }

    return null;
}

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
        // 1. Fetch ALL scheduled Upcoming Orders (they are templates, no date filtering)
        const { data: upcomingOrders, error: fetchError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('status', 'scheduled')
            .order('delivery_day', { ascending: true });

        if (fetchError) {
            throw new Error(`Failed to fetch upcoming orders: ${fetchError.message}`);
        }

        if (!upcomingOrders || upcomingOrders.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No scheduled upcoming orders found.',
                totalFound: 0,
                processedCount: 0,
                skippedCount: 0
            });
        }

        let processedCount = 0;
        let skippedCount = 0;
        const errors: string[] = [];
        const skippedReasons: string[] = [];
        const debugLogs: string[] = []; // Collect logs to return in response

        // Fetch menu items to get correct prices
        const menuItems = await getMenuItems();
        console.log(`[Simulate Delivery] Loaded ${menuItems.length} menu items for price lookup`);
        debugLogs.push(`Loaded ${menuItems.length} menu items for price lookup`);

        console.log(`[Simulate Delivery] Found ${upcomingOrders.length} upcoming orders to process`);
        debugLogs.push(`Found ${upcomingOrders.length} upcoming orders to process`);

        // Get the starting order number (ensures at least 6 digits, starting from 100000)
        const { data: maxOrderData } = await supabase
            .from('orders')
            .select('order_number')
            .order('order_number', { ascending: false })
            .limit(1)
            .maybeSingle();

        const { data: maxUpcomingData } = await supabase
            .from('upcoming_orders')
            .select('order_number')
            .order('order_number', { ascending: false })
            .limit(1)
            .maybeSingle();

        const maxOrderNum = maxOrderData?.order_number || 0;
        const maxUpcomingNum = maxUpcomingData?.order_number || 0;
        const maxNum = Math.max(maxOrderNum, maxUpcomingNum);

        // Start from max + 1, ensuring at least 6 digits (100000 = 6 digits minimum)
        let nextOrderNumber = Math.max(100000, maxNum + 1);

        for (const upOrder of upcomingOrders) {
            console.log(`[Simulate Delivery] Processing upcoming order ${upOrder.id} (client: ${upOrder.client_id}, delivery_day: ${upOrder.delivery_day || 'null'})`);

            // Calculate the actual delivery date from the delivery_day (day of week)
            const deliveryDate = await calculateNextDeliveryDate(upOrder.delivery_day);

            if (!deliveryDate) {
                const errorMsg = `Cannot calculate delivery date for upcoming order ${upOrder.id}: delivery_day is "${upOrder.delivery_day || 'null'}"`;
                console.warn(`[Simulate Delivery] SKIPPED: ${errorMsg}`);
                errors.push(errorMsg);
                skippedReasons.push(`Order ${upOrder.id}: Missing or invalid delivery_day`);
                skippedCount++;
                continue;
            }

            // Check for duplicates: Does an order with this client_id and delivery date already exist?
            // We check client_id + delivery date to prevent creating duplicate orders for the same delivery
            const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
            const { count: duplicateCount, error: duplicateError } = await supabase
                .from('orders')
                .select('*', { count: 'exact', head: true })
                .eq('client_id', upOrder.client_id)
                .eq('scheduled_delivery_date', deliveryDateStr);

            if (duplicateError) {
                errors.push(`Error checking duplicates for order ${upOrder.id}: ${duplicateError.message}`);
            }

            if (duplicateCount && duplicateCount > 0) {
                const skipMsg = `Order ${upOrder.id}: Duplicate order already exists for client ${upOrder.client_id} on ${deliveryDateStr}`;
                console.warn(`[Simulate Delivery] SKIPPED: ${skipMsg}`);
                skippedReasons.push(skipMsg);
                skippedCount++;
                continue;
            }

            const logMsg = `[Simulate Delivery] Upcoming order ${upOrder.id} has total_value: ${upOrder.total_value}, total_items: ${upOrder.total_items}`;
            console.log(logMsg);
            debugLogs.push(logMsg);

            // Create Order with calculated delivery date
            // Note: Valid statuses are: 'scheduled', 'processed', 'delivered'
            const orderData: any = {
                client_id: upOrder.client_id,
                service_type: upOrder.service_type,
                case_id: upOrder.case_id || `CASE-${Date.now()}-${processedCount}`,
                status: 'scheduled', // Valid status for new orders (will be 'delivered' when proof is uploaded)
                scheduled_delivery_date: deliveryDateStr, // Calculated from delivery_day
                delivery_distribution: upOrder.delivery_distribution,
                total_value: upOrder.total_value, // Will be recalculated after items are copied
                total_items: upOrder.total_items,
                notes: upOrder.notes,
                order_number: nextOrderNumber, // Set explicit 6-digit order number (at least 100000)
                created_at: new Date().toISOString(),
                last_updated: new Date().toISOString(),
                updated_by: upOrder.updated_by // Preserve updated_by from the upcoming order
            };

            const logMsg2 = `[Simulate Delivery] Creating order with initial total_value: ${orderData.total_value}`;
            console.log(logMsg2);
            debugLogs.push(logMsg2);

            const { data: newOrder, error: insertError } = await supabase
                .from('orders')
                .insert(orderData)
                .select()
                .single();

            if (insertError || !newOrder) {
                const errorMsg = `Failed to create order for client ${upOrder.client_id}: ${insertError?.message}`;
                console.error(`[Simulate Delivery] ERROR: ${errorMsg}`);
                errors.push(errorMsg);
                skippedReasons.push(`Order ${upOrder.id}: Failed to create - ${insertError?.message || 'Unknown error'}`);
                skippedCount++;
                continue;
            }

            console.log(`[Simulate Delivery] SUCCESS: Created order ${newOrder.id} (Order #${nextOrderNumber}) for client ${upOrder.client_id} with delivery date ${deliveryDateStr}`);

            // Copy Child Records
            // 1. Vendor Selections & Items (Food)
            let calculatedTotalFromItems = 0;
            if (upOrder.service_type === 'Food') {
                const logMsg3 = `[Simulate Delivery] Processing Food order - copying vendor selections and items`;
                console.log(logMsg3);
                debugLogs.push(logMsg3);
                
                const { data: vendorSelections } = await supabase
                    .from('upcoming_order_vendor_selections')
                    .select('*')
                    .eq('upcoming_order_id', upOrder.id);

                const logMsg4 = `[Simulate Delivery] Found ${vendorSelections?.length || 0} vendor selections`;
                console.log(logMsg4);
                debugLogs.push(logMsg4);

                if (vendorSelections) {
                    for (const vs of vendorSelections) {
                        const logMsg5 = `[Simulate Delivery] Processing vendor selection ${vs.id} for vendor ${vs.vendor_id}`;
                        console.log(logMsg5);
                        debugLogs.push(logMsg5);
                        
                        const { data: newVs, error: vsError } = await supabase
                            .from('order_vendor_selections')
                            .insert({
                                order_id: newOrder.id,
                                vendor_id: vs.vendor_id
                            })
                            .select()
                            .single();

                        if (vsError || !newVs) {
                            const errorMsg = `[Simulate Delivery] Error creating vendor selection: ${vsError?.message || 'Unknown error'}`;
                            console.error(errorMsg);
                            debugLogs.push(errorMsg);
                            continue;
                        }

                        const { data: items } = await supabase
                            .from('upcoming_order_items')
                            .select('*')
                            .eq('vendor_selection_id', vs.id);

                        const logMsg6 = `[Simulate Delivery] Found ${items?.length || 0} items for vendor selection ${vs.id}`;
                        console.log(logMsg6);
                        debugLogs.push(logMsg6);

                        if (items) {
                            for (const item of items) {
                                // Skip total items (menu_item_id is null)
                                if (item.menu_item_id === null) {
                                    const skipMsg = `[Simulate Delivery] Skipping total item with null menu_item_id: total_value=${item.total_value}`;
                                    console.log(skipMsg);
                                    debugLogs.push(skipMsg);
                                    continue;
                                }

                                // Find the menu item to get the correct price
                                const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                                // Use priceEach if available, otherwise fall back to stored unit_value
                                const correctPrice = menuItem?.priceEach ?? parseFloat(item.unit_value?.toString() || '0');
                                
                                const itemInfo = {
                                    menu_item_id: item.menu_item_id,
                                    menuItemName: menuItem?.name || 'Unknown',
                                    quantity: item.quantity,
                                    stored_unit_value: item.unit_value,
                                    correct_price: correctPrice,
                                    menuItemPriceEach: menuItem?.priceEach,
                                    menuItemValue: menuItem?.value,
                                    stored_total_value: item.total_value
                                };
                                const logMsg7 = `[Simulate Delivery] Copying item: ${JSON.stringify(itemInfo)}`;
                                console.log(logMsg7);
                                debugLogs.push(logMsg7);

                                // Recalculate item total using correct price (priceEach) and quantity
                                const itemTotal = correctPrice * item.quantity;
                                calculatedTotalFromItems += itemTotal;

                                const logMsg8 = `[Simulate Delivery] Calculated item total: ${correctPrice} * ${item.quantity} = ${itemTotal}`;
                                console.log(logMsg8);
                                debugLogs.push(logMsg8);
                                
                                const logMsg9 = `[Simulate Delivery] Running total from items: ${calculatedTotalFromItems}`;
                                console.log(logMsg9);
                                debugLogs.push(logMsg9);

                                const newItem = {
                                    order_id: newOrder.id,
                                    vendor_selection_id: newVs.id,
                                    menu_item_id: item.menu_item_id,
                                    quantity: item.quantity,
                                    unit_value: correctPrice, // Use correct price (priceEach), not stored unit_value
                                    total_value: itemTotal // Use recalculated total
                                };

                                const { error: itemError } = await supabase.from('order_items').insert(newItem);
                                if (itemError) {
                                    const errorMsg2 = `[Simulate Delivery] Error inserting item: ${itemError.message}`;
                                    console.error(errorMsg2);
                                    debugLogs.push(errorMsg2);
                                }
                            }
                        }
                    }
                }

                const logMsg10 = `[Simulate Delivery] Final calculated total from items: ${calculatedTotalFromItems}`;
                console.log(logMsg10);
                debugLogs.push(logMsg10);
                
                const logMsg11 = `[Simulate Delivery] Original upcoming order total_value: ${upOrder.total_value}`;
                console.log(logMsg11);
                debugLogs.push(logMsg11);

                // Update order total_value if it doesn't match calculated total
                if (calculatedTotalFromItems > 0 && calculatedTotalFromItems !== upOrder.total_value) {
                    const logMsg12 = `[Simulate Delivery] Mismatch detected! Updating order total_value from ${upOrder.total_value} to ${calculatedTotalFromItems}`;
                    console.log(logMsg12);
                    debugLogs.push(logMsg12);
                    
                    const { error: updateError } = await supabase
                        .from('orders')
                        .update({ total_value: calculatedTotalFromItems })
                        .eq('id', newOrder.id);

                    if (updateError) {
                        const errorMsg3 = `[Simulate Delivery] Error updating total_value: ${updateError.message}`;
                        console.error(errorMsg3);
                        debugLogs.push(errorMsg3);
                    } else {
                        const logMsg13 = `[Simulate Delivery] Successfully updated order total_value to ${calculatedTotalFromItems}`;
                        console.log(logMsg13);
                        debugLogs.push(logMsg13);
                    }
                } else {
                    const logMsg14 = `[Simulate Delivery] Total values match or calculated total is 0, no update needed`;
                    console.log(logMsg14);
                    debugLogs.push(logMsg14);
                }
            }

            // 2. Box Selections (Boxes)
            if (upOrder.service_type === 'Boxes') {
                const { data: boxSelections } = await supabase
                    .from('upcoming_order_box_selections')
                    .select('*')
                    .eq('upcoming_order_id', upOrder.id);

                if (boxSelections) {
                    const newBoxSelections = boxSelections.map(bs => ({
                        order_id: newOrder.id,
                        // box_type_id: bs.box_type_id, // Removed: column does not exist on table order_box_selections
                        vendor_id: bs.vendor_id,
                        quantity: bs.quantity,
                        unit_value: bs.unit_value,
                        total_value: bs.total_value,
                        items: bs.items // Copy box items/prices stored in JSONB
                    }));
                    await supabase.from('order_box_selections').insert(newBoxSelections);
                }
            }

            // Increment order number for next order
            nextOrderNumber++;
            processedCount++;
        }

        console.log(`[Simulate Delivery] Complete: ${processedCount} created, ${skippedCount} skipped, ${errors.length} errors`);

        const totalFound = upcomingOrders.length;
        const message = totalFound === 0
            ? 'No scheduled upcoming orders found.'
            : `Simulation complete. Found ${totalFound} upcoming order(s). Created ${processedCount} order(s). Skipped ${skippedCount} order(s).`;

        return NextResponse.json({
            success: true,
            message,
            totalFound,
            processedCount,
            skippedCount,
            errors: errors.length > 0 ? errors : undefined,
            skippedReasons: skippedReasons.length > 0 ? skippedReasons : undefined,
            debugLogs: debugLogs.length > 0 ? debugLogs : undefined
        });

    } catch (error: any) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}
