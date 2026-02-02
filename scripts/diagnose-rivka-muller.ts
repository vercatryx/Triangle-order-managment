import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnoseRivkaMuller() {
    console.log('Searching for RIVKA MULLER...');
    console.log('='.repeat(80));

    // Search for client
    const { data: clients, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .or('full_name.ilike.%RIVKA%,full_name.ilike.%MULLER%,full_name.ilike.%RIVK%,full_name.ilike.%MULL%')
        .order('full_name');

    if (clientError) {
        console.error('Error fetching clients:', clientError);
        return;
    }

    if (!clients || clients.length === 0) {
        console.log('No clients found matching RIVKA/MULLER');
        return;
    }

    console.log(`Found ${clients.length} client(s):\n`);

    for (const client of clients) {
        console.log(`CLIENT: ${client.full_name} (${client.id})`);
        console.log(`  Service Type: ${client.serviceType}`);
        console.log(`  Active Order: ${client.active_order ? 'YES' : 'NO'}`);
        
        if (client.active_order) {
            const ao = client.active_order;
            console.log(`    Service Type: ${ao.serviceType}`);
            console.log(`    Case ID: ${ao.caseId}`);
            console.log(`    Vendor Selections: ${ao.vendorSelections?.length || 0}`);
            if (ao.vendorSelections && ao.vendorSelections.length > 0) {
                ao.vendorSelections.forEach((vs: any, i: number) => {
                    console.log(`      VS ${i + 1}: vendorId=${vs.vendorId || 'null'}, items=${Object.keys(vs.items || {}).length}`);
                });
            }
        }

        // Check upcoming orders
        const { data: upcomingOrders, error: uoError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('client_id', client.id)
            .eq('status', 'scheduled')
            .order('created_at', { ascending: false });

        if (uoError) {
            console.error(`  Error fetching upcoming orders:`, uoError);
        } else {
            console.log(`\n  Upcoming Orders: ${upcomingOrders?.length || 0}`);
            
            for (const order of upcomingOrders || []) {
                console.log(`\n    Order ID: ${order.id}`);
                console.log(`      Service Type: ${order.service_type}`);
                console.log(`      Status: ${order.status}`);
                console.log(`      Case ID: ${order.case_id}`);
                console.log(`      Delivery Day: ${order.delivery_day}`);
                console.log(`      Total Value: ${order.total_value}`);
                console.log(`      Total Items: ${order.total_items}`);
                console.log(`      Created: ${order.created_at}`);

                // Check vendor selections
                const { data: vendorSelections, error: vsError } = await supabase
                    .from('upcoming_order_vendor_selections')
                    .select('*')
                    .eq('upcoming_order_id', order.id);

                if (vsError) {
                    console.error(`      Error fetching vendor selections:`, vsError);
                } else {
                    console.log(`      Vendor Selections: ${vendorSelections?.length || 0}`);
                    
                    for (const vs of vendorSelections || []) {
                        console.log(`        VS ID: ${vs.id}, Vendor ID: ${vs.vendor_id || 'NULL'}`);
                        
                        // Check items for this VS
                        const { data: items, error: itemsError } = await supabase
                            .from('upcoming_order_items')
                            .select('*')
                            .eq('vendor_selection_id', vs.id);

                        if (itemsError) {
                            console.error(`          Error fetching items:`, itemsError);
                        } else {
                            console.log(`          Items: ${items?.length || 0}`);
                            items?.slice(0, 3).forEach((item: any) => {
                                console.log(`            - menu_item_id=${item.menu_item_id}, meal_item_id=${item.meal_item_id}, qty=${item.quantity}`);
                            });
                        }
                    }
                }

                // Check all items for this order (including orphaned)
                const { data: allItems, error: allItemsError } = await supabase
                    .from('upcoming_order_items')
                    .select('*')
                    .eq('upcoming_order_id', order.id);

                if (allItemsError) {
                    console.error(`      Error fetching all items:`, allItemsError);
                } else {
                    const orphanedItems = allItems?.filter(item => !item.vendor_selection_id) || [];
                    if (orphanedItems.length > 0) {
                        console.log(`      ⚠️  ORPHANED ITEMS (no vendor_selection_id): ${orphanedItems.length}`);
                        orphanedItems.slice(0, 3).forEach((item: any) => {
                            console.log(`        - menu_item_id=${item.menu_item_id}, meal_item_id=${item.meal_item_id}, qty=${item.quantity}`);
                        });
                    }
                }
            }
        }

        console.log('\n' + '='.repeat(80) + '\n');
    }
}

diagnoseRivkaMuller().catch(console.error);
