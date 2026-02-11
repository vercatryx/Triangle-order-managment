import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface ReassignRequest {
    clientId: string;
    oldDeliveryDay: string;
    newDeliveryDay: string;
    vendorId: string;
}

/**
 * POST - Reassign an order from one delivery day to another
 */
export async function POST(request: NextRequest) {
    try {
        const body: ReassignRequest = await request.json();
        const { clientId, oldDeliveryDay, newDeliveryDay, vendorId } = body;

        if (!clientId || !oldDeliveryDay || !newDeliveryDay) {
            return NextResponse.json({
                success: false,
                error: 'clientId, oldDeliveryDay, and newDeliveryDay are required'
            }, { status: 400 });
        }

        console.log(`[reassign] Reassigning ${clientId} from ${oldDeliveryDay} to ${newDeliveryDay}`);

        // 1. Update upcoming_orders table
        const { data: upcomingOrders, error: uoError } = await supabase
            .from('upcoming_orders')
            .select('id')
            .eq('client_id', clientId)
            .eq('delivery_day', oldDeliveryDay)
            .eq('status', 'scheduled');

        if (uoError) throw uoError;

        if (upcomingOrders && upcomingOrders.length > 0) {
            const orderIds = upcomingOrders.map(o => o.id);

            // Check if there's already an order for the new day
            const { data: existingNewDay } = await supabase
                .from('upcoming_orders')
                .select('id')
                .eq('client_id', clientId)
                .eq('delivery_day', newDeliveryDay)
                .eq('status', 'scheduled')
                .single();

            if (existingNewDay) {
                // Merge: move vendor selections and items to existing order
                for (const orderId of orderIds) {
                    // Get vendor selections from old order
                    const { data: oldVs } = await supabase
                        .from('upcoming_order_vendor_selections')
                        .select('*, upcoming_order_items(*)')
                        .eq('upcoming_order_id', orderId);

                    if (oldVs) {
                        for (const vs of oldVs) {
                            // Create new vendor selection in target order
                            const { data: newVs, error: newVsError } = await supabase
                                .from('upcoming_order_vendor_selections')
                                .insert({
                                    upcoming_order_id: existingNewDay.id,
                                    vendor_id: vs.vendor_id
                                })
                                .select()
                                .single();

                            if (newVsError) {
                                console.error('Error creating new VS:', newVsError);
                                continue;
                            }

                            // Move items
                            if (vs.upcoming_order_items && newVs) {
                                const itemsToInsert = vs.upcoming_order_items.map((item: any) => ({
                                    upcoming_order_id: existingNewDay.id,
                                    vendor_selection_id: newVs.id,
                                    menu_item_id: item.menu_item_id,
                                    meal_item_id: item.meal_item_id,
                                    quantity: item.quantity,
                                    unit_value: item.unit_value,
                                    total_value: item.total_value,
                                    notes: item.notes
                                }));

                                await supabase.from('upcoming_order_items').insert(itemsToInsert);
                            }
                        }
                    }

                    // Delete old order and its relations
                    await supabase.from('upcoming_order_items').delete().eq('upcoming_order_id', orderId);
                    await supabase.from('upcoming_order_vendor_selections').delete().eq('upcoming_order_id', orderId);
                    await supabase.from('upcoming_orders').delete().eq('id', orderId);
                }
            } else {
                // Simple update: just change the delivery_day
                const { error: updateError } = await supabase
                    .from('upcoming_orders')
                    .update({ delivery_day: newDeliveryDay })
                    .in('id', orderIds);

                if (updateError) throw updateError;
            }
        }

        // 2. Update active_order in clients table
        const { data: client, error: clientError } = await supabase
            .from('clients')
            .select('active_order')
            .eq('id', clientId)
            .single();

        if (clientError) throw clientError;

        if (client?.active_order?.deliveryDayOrders) {
            const ao = { ...client.active_order };
            const ddo = { ...ao.deliveryDayOrders };

            if (ddo[oldDeliveryDay]) {
                // If target day exists, merge; otherwise move
                if (ddo[newDeliveryDay]) {
                    // Merge vendor selections
                    const oldSelections = ddo[oldDeliveryDay].vendorSelections || [];
                    const newSelections = ddo[newDeliveryDay].vendorSelections || [];

                    // Filter to only merge the specific vendor if specified
                    const selectionsToMove = vendorId
                        ? oldSelections.filter((vs: any) => vs.vendorId === vendorId)
                        : oldSelections;

                    ddo[newDeliveryDay] = {
                        ...ddo[newDeliveryDay],
                        vendorSelections: [...newSelections, ...selectionsToMove]
                    };

                    // Remove from old day
                    if (vendorId) {
                        ddo[oldDeliveryDay] = {
                            ...ddo[oldDeliveryDay],
                            vendorSelections: oldSelections.filter((vs: any) => vs.vendorId !== vendorId)
                        };
                        // Remove old day if empty
                        if (ddo[oldDeliveryDay].vendorSelections.length === 0) {
                            delete ddo[oldDeliveryDay];
                        }
                    } else {
                        delete ddo[oldDeliveryDay];
                    }
                } else {
                    // Move entirely
                    ddo[newDeliveryDay] = ddo[oldDeliveryDay];
                    delete ddo[oldDeliveryDay];
                }

                ao.deliveryDayOrders = ddo;

                const { error: updateError } = await supabase
                    .from('clients')
                    .update({
                        active_order: ao,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', clientId);

                if (updateError) throw updateError;
            }
        }

        return NextResponse.json({
            success: true,
            message: `Successfully reassigned order from ${oldDeliveryDay} to ${newDeliveryDay}`
        });

    } catch (error: any) {
        console.error('[reassign] Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
