import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: NextRequest) {
    try {
        console.log('Searching for RIVKA MULLER...');

        // Search for client
        const { data: clients, error: clientError } = await supabase
            .from('clients')
            .select('*')
            .or('full_name.ilike.%RIVKA%,full_name.ilike.%MULLER%,full_name.ilike.%RIVK%,full_name.ilike.%MULL%')
            .order('full_name');

        if (clientError) {
            return NextResponse.json({ error: clientError.message }, { status: 500 });
        }

        if (!clients || clients.length === 0) {
            return NextResponse.json({ message: 'No clients found matching RIVKA/MULLER', clients: [] });
        }

        const results: any[] = [];

        for (const client of clients) {
            const clientData: any = {
                id: client.id,
                full_name: client.full_name,
                serviceType: client.serviceType,
                active_order: client.active_order,
                upcoming_orders: []
            };

            // Check upcoming orders
            const { data: upcomingOrders, error: uoError } = await supabase
                .from('upcoming_orders')
                .select('*')
                .eq('client_id', client.id)
                .eq('status', 'scheduled')
                .order('created_at', { ascending: false });

            if (!uoError && upcomingOrders) {
                for (const order of upcomingOrders) {
                    const orderData: any = {
                        id: order.id,
                        service_type: order.service_type,
                        status: order.status,
                        case_id: order.case_id,
                        delivery_day: order.delivery_day,
                        total_value: order.total_value,
                        total_items: order.total_items,
                        created_at: order.created_at,
                        vendor_selections: [],
                        all_items: []
                    };

                    // Check vendor selections
                    const { data: vendorSelections, error: vsError } = await supabase
                        .from('upcoming_order_vendor_selections')
                        .select('*')
                        .eq('upcoming_order_id', order.id);

                    if (!vsError && vendorSelections) {
                        for (const vs of vendorSelections) {
                            const vsData: any = {
                                id: vs.id,
                                vendor_id: vs.vendor_id,
                                items: []
                            };

                            // Check items for this VS
                            const { data: items, error: itemsError } = await supabase
                                .from('upcoming_order_items')
                                .select('*')
                                .eq('vendor_selection_id', vs.id);

                            if (!itemsError && items) {
                                vsData.items = items;
                            }

                            orderData.vendor_selections.push(vsData);
                        }
                    }

                    // Check all items for this order (including orphaned)
                    const { data: allItems, error: allItemsError } = await supabase
                        .from('upcoming_order_items')
                        .select('*')
                        .eq('upcoming_order_id', order.id);

                    if (!allItemsError && allItems) {
                        orderData.all_items = allItems;
                        orderData.orphaned_items = allItems.filter((item: any) => !item.vendor_selection_id);
                    }

                    clientData.upcoming_orders.push(orderData);
                }
            }

            results.push(clientData);
        }

        return NextResponse.json({
            message: `Found ${clients.length} client(s)`,
            clients: results
        });
    } catch (error: any) {
        console.error('Error diagnosing RIVKA MULLER:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
