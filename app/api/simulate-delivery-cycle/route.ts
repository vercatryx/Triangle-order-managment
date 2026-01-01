import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getCurrentTime } from '@/lib/time';

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

        console.log(`[Simulate Delivery] Found ${upcomingOrders.length} upcoming orders to process`);

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

            // Create Order with calculated delivery date
            // Note: Valid statuses are: 'scheduled', 'processed', 'delivered'
            const orderData: any = {
                client_id: upOrder.client_id,
                service_type: upOrder.service_type,
                case_id: upOrder.case_id || `CASE-${Date.now()}-${processedCount}`,
                status: 'scheduled', // Valid status for new orders (will be 'delivered' when proof is uploaded)
                scheduled_delivery_date: deliveryDateStr, // Calculated from delivery_day
                delivery_distribution: upOrder.delivery_distribution,
                total_value: upOrder.total_value,
                total_items: upOrder.total_items,
                notes: upOrder.notes,
                order_number: nextOrderNumber, // Set explicit 6-digit order number (at least 100000)
                created_at: new Date().toISOString(),
                last_updated: new Date().toISOString(),
                updated_by: upOrder.updated_by // Preserve updated_by from the upcoming order
            };

            const { data: newOrder, error: insertError } = await supabase
                .from('orders')
                .insert(orderData)
                .select()
                .single();

            if (insertError || !newOrder) {
                const errorMsg = `Failed to create order for client ${upOrder.client_id}: ${insertError?.message}`;
                console.error(`[Simulate Delivery] ERROR: ${errorMsg}`);
                errors.push(errorMsg);
                continue;
            }

            console.log(`[Simulate Delivery] SUCCESS: Created order ${newOrder.id} (Order #${nextOrderNumber}) for client ${upOrder.client_id} with delivery date ${deliveryDateStr}`);

            // Copy Child Records
            // 1. Vendor Selections & Items (Food)
            if (upOrder.service_type === 'Food') {
                const { data: vendorSelections } = await supabase
                    .from('upcoming_order_vendor_selections')
                    .select('*')
                    .eq('upcoming_order_id', upOrder.id);

                if (vendorSelections) {
                    for (const vs of vendorSelections) {
                        const { data: newVs, error: vsError } = await supabase
                            .from('order_vendor_selections')
                            .insert({
                                order_id: newOrder.id,
                                vendor_id: vs.vendor_id
                            })
                            .select()
                            .single();

                        if (vsError || !newVs) continue;

                        const { data: items } = await supabase
                            .from('upcoming_order_items')
                            .select('*')
                            .eq('vendor_selection_id', vs.id);

                        if (items) {
                            const newItems = items.map(item => ({
                                order_id: newOrder.id,
                                vendor_selection_id: newVs.id,
                                menu_item_id: item.menu_item_id,
                                quantity: item.quantity,
                                unit_value: item.unit_value,
                                total_value: item.total_value
                            }));
                            await supabase.from('order_items').insert(newItems);
                        }
                    }
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
            skippedReasons: skippedReasons.length > 0 ? skippedReasons : undefined
        });

    } catch (error: any) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}
