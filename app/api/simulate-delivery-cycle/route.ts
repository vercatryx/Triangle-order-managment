import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { randomUUID } from 'crypto';

/**
 * API Route: Simulate Delivery Cycle
 * 
 * POST /api/simulate-delivery-cycle
 * 
 * Logic:
 * 1. Find all Upcoming Orders where scheduled_delivery_date <= Today (or provided date).
 * 2. For each match:
 *    - Create a new Order in 'orders' table.
 *    - Status = 'waiting_for_proof'.
 *    - Maintain link to Client (client_id).
 *    - Copy all vendor selections/items/boxes.
 * 3. Do NOT modify the original Upcoming Order.
 */
export async function POST(request: NextRequest) {
    try {
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        const todayIso = today.toISOString();

        // 1. Fetch relevant Upcoming Orders
        const { data: upcomingOrders, error: fetchError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .lte('scheduled_delivery_date', todayIso)
            .neq('status', 'processed') // Optional: Avoid re-processing if you had that flag (though user said non-destructive, we should probably check if an order for this case_id/date already exists to prevent duplicates)
            .order('scheduled_delivery_date', { ascending: true });

        if (fetchError) {
            throw new Error(`Failed to fetch upcoming orders: ${fetchError.message}`);
        }

        if (!upcomingOrders || upcomingOrders.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No upcoming orders found for today or earlier.',
                processedCount: 0
            });
        }

        let processedCount = 0;
        let skippedCount = 0;
        const errors: string[] = [];

        for (const upOrder of upcomingOrders) {
            // Check for duplicates: Does an order with this case_id already exist?
            // (Assuming case_id is the unique identifier for a cycle)
            if (upOrder.case_id) {
                const { count } = await supabase
                    .from('orders')
                    .select('*', { count: 'exact', head: true })
                    .eq('case_id', upOrder.case_id);

                if (count && count > 0) {
                    skippedCount++;
                    continue;
                }
            }

            // Create Order
            const orderData = {
                client_id: upOrder.client_id,
                service_type: upOrder.service_type,
                case_id: upOrder.case_id || `CASE-${Date.now()}-${processedCount}`,
                status: 'waiting_for_proof', // New initial status
                scheduled_delivery_date: upOrder.scheduled_delivery_date,
                delivery_distribution: upOrder.delivery_distribution,
                total_value: upOrder.total_value,
                total_items: upOrder.total_items,
                notes: upOrder.notes,
                created_at: new Date().toISOString(),
                last_updated: new Date().toISOString(),
                updated_by: 'System Simulation'
            };

            const { data: newOrder, error: insertError } = await supabase
                .from('orders')
                .insert(orderData)
                .select()
                .single();

            if (insertError || !newOrder) {
                errors.push(`Failed to create order for client ${upOrder.client_id}: ${insertError?.message}`);
                continue;
            }

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
                        box_type_id: bs.box_type_id,
                        vendor_id: bs.vendor_id,
                        quantity: bs.quantity,
                        unit_value: bs.unit_value,
                        total_value: bs.total_value,
                        items: bs.items // Copy box items/prices stored in JSONB
                    }));
                    await supabase.from('order_box_selections').insert(newBoxSelections);
                }
            }

            processedCount++;
        }

        return NextResponse.json({
            success: true,
            message: `Simulation complete. Created ${processedCount} orders. Skipped ${skippedCount} duplicates.`,
            processedCount,
            skippedCount,
            errors
        });

    } catch (error: any) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}
