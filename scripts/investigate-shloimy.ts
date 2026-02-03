/**
 * Temporary diagnostic script to investigate Shloimy Klein's data
 * This script will dump all relevant data from both sources of truth
 * to understand why this client might be showing up in sidebar but not profile
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigateClient() {
    console.log('\n========================================');
    console.log('INVESTIGATING: Shloimy Klein');
    console.log('========================================\n');

    // 1. Find the client by name search
    console.log('1. SEARCHING FOR CLIENT BY NAME...\n');

    const { data: clientSearch, error: searchError } = await supabase
        .from('clients')
        .select('*')
        .ilike('full_name', '%Shloimy%Klein%');

    if (searchError) {
        console.error('Error searching for client:', searchError);
        return;
    }

    if (!clientSearch || clientSearch.length === 0) {
        console.log('No client found with name containing "Shloimy Klein"');

        // Try broader search
        console.log('\nTrying broader search...');
        const { data: broadSearch } = await supabase
            .from('clients')
            .select('id, full_name, status, service_type')
            .or('full_name.ilike.%Shloimy%,full_name.ilike.%Klein%');

        if (broadSearch && broadSearch.length > 0) {
            console.log('Found similar clients:');
            broadSearch.forEach(c => console.log(`  - ${c.full_name} (${c.id}) [${c.status}] [${c.service_type}]`));
        }
        return;
    }

    console.log(`Found ${clientSearch.length} client(s) matching "Shloimy Klein":\n`);

    for (const client of clientSearch) {
        console.log('----------------------------------------');
        console.log(`CLIENT: ${client.full_name}`);
        console.log(`ID: ${client.id}`);
        console.log('----------------------------------------\n');

        // 2. Basic client info
        console.log('2. BASIC CLIENT INFO:');
        console.log(`   Status: ${client.status}`);
        console.log(`   Service Type: ${client.service_type}`);
        console.log(`   Created: ${client.created_at}`);
        console.log(`   Updated: ${client.updated_at}`);
        console.log(`   Phone: ${client.phone || 'N/A'}`);
        console.log(`   Case ID: ${client.case_id || 'N/A'}`);

        // 3. Check active_order
        console.log('\n3. ACTIVE_ORDER (clients.active_order column):');
        const activeOrder = client.active_order;
        if (activeOrder && typeof activeOrder === 'object' && Object.keys(activeOrder).length > 0) {
            console.log('   EXISTS: YES');
            console.log(`   Service Type: ${activeOrder.serviceType}`);
            console.log(`   Case ID: ${activeOrder.caseId}`);

            if (activeOrder.vendorSelections) {
                console.log(`   Vendor Selections: ${activeOrder.vendorSelections.length}`);
                activeOrder.vendorSelections.forEach((vs: any, i: number) => {
                    const itemCount = vs.items ? Object.keys(vs.items).length : 0;
                    console.log(`     [${i}] vendorId: ${vs.vendorId || 'NULL'}, items: ${itemCount}`);
                });
            }

            if (activeOrder.mealSelections) {
                console.log(`   Meal Selections: ${JSON.stringify(Object.keys(activeOrder.mealSelections))}`);
                Object.entries(activeOrder.mealSelections).forEach(([key, val]: [string, any]) => {
                    const itemCount = val.items ? Object.keys(val.items).length : 0;
                    console.log(`     [${key}] vendorId: ${val.vendorId || 'NULL'}, items: ${itemCount}`);
                });
            }

            if (activeOrder.boxOrders) {
                console.log(`   Box Orders: ${activeOrder.boxOrders.length}`);
            }

            if (activeOrder.deliveryDayOrders) {
                console.log(`   Delivery Day Orders: ${JSON.stringify(Object.keys(activeOrder.deliveryDayOrders))}`);
            }

            console.log('\n   FULL active_order JSON:');
            console.log(JSON.stringify(activeOrder, null, 2).split('\n').map(l => '   ' + l).join('\n'));
        } else {
            console.log('   EXISTS: NO (empty or null)');
        }

        // 4. Check upcoming_orders
        console.log('\n4. UPCOMING_ORDERS (upcoming_orders table):');
        const { data: upcomingOrders, error: uoError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('client_id', client.id);

        if (uoError) {
            console.log(`   ERROR: ${uoError.message}`);
        } else if (!upcomingOrders || upcomingOrders.length === 0) {
            console.log('   EXISTS: NO (no records in table)');
        } else {
            console.log(`   EXISTS: YES (${upcomingOrders.length} record(s))`);
            for (const uo of upcomingOrders) {
                console.log(`\n   Order ID: ${uo.id}`);
                console.log(`   Status: ${uo.status}`);
                console.log(`   Service Type: ${uo.service_type}`);
                console.log(`   Case ID: ${uo.case_id}`);
                console.log(`   Delivery Day: ${uo.delivery_day}`);
                console.log(`   Meal Type: ${uo.meal_type}`);
                console.log(`   Total Value: ${uo.total_value}`);
                console.log(`   Total Items: ${uo.total_items}`);

                // Get vendor selections for this upcoming order
                const { data: vendorSels } = await supabase
                    .from('upcoming_order_vendor_selections')
                    .select('*, vendors(name)')
                    .eq('upcoming_order_id', uo.id);

                if (vendorSels && vendorSels.length > 0) {
                    console.log(`   Vendor Selections: ${vendorSels.length}`);
                    for (const vs of vendorSels) {
                        console.log(`     - ID: ${vs.id}, Vendor: ${vs.vendors?.name || vs.vendor_id || 'NULL'}`);

                        // Get items for this vendor selection
                        const { data: items } = await supabase
                            .from('upcoming_order_items')
                            .select('*, menu_items(name), meal_items(name)')
                            .eq('vendor_selection_id', vs.id);

                        if (items && items.length > 0) {
                            console.log(`       Items: ${items.length}`);
                            items.forEach(item => {
                                const name = item.menu_items?.name || item.meal_items?.name || 'Unknown';
                                console.log(`         - ${name} x${item.quantity} = $${item.total_value}`);
                            });
                        }
                    }
                } else {
                    console.log('   Vendor Selections: NONE');
                }

                // Check for box selections
                const { data: boxSels } = await supabase
                    .from('upcoming_order_box_selections')
                    .select('*, box_types(name), vendors(name)')
                    .eq('upcoming_order_id', uo.id);

                if (boxSels && boxSels.length > 0) {
                    console.log(`   Box Selections: ${boxSels.length}`);
                    boxSels.forEach(bs => {
                        console.log(`     - ${bs.box_types?.name} from ${bs.vendors?.name || 'Unknown'}, qty: ${bs.quantity}`);
                    });
                }
            }
        }

        // 5. DIAGNOSIS
        console.log('\n5. DIAGNOSIS:');
        const hasActiveOrder = activeOrder && typeof activeOrder === 'object' && Object.keys(activeOrder).length > 0;
        const hasUpcomingOrders = upcomingOrders && upcomingOrders.length > 0;
        const hasScheduledUpcoming = upcomingOrders?.some(uo => uo.status === 'scheduled');

        if (hasActiveOrder && hasUpcomingOrders) {
            console.log('   STATUS: BOTH sources have data');
            console.log('   This client SHOULD appear in client profile');
            console.log('   If not showing, check if data matches between sources');
        } else if (hasActiveOrder && !hasUpcomingOrders) {
            console.log('   STATUS: ONLY active_order has data');
            console.log('   This client shows in sidebar (from active_order)');
            console.log('   But may not sync properly to upcoming_orders');
            console.log('   SOLUTION: Need to run "Use Active Order" sync');
        } else if (!hasActiveOrder && hasUpcomingOrders) {
            console.log('   STATUS: ONLY upcoming_orders has data');
            console.log('   This client may show in some views but not others');
            console.log('   SOLUTION: Need to run "Use Upcoming Orders" sync');
        } else {
            console.log('   STATUS: NEITHER source has data');
            console.log('   This client should not show any orders');
        }

        // Check for specific issues
        if (hasActiveOrder) {
            const ao = activeOrder;
            let hasVendorButNoItems = false;
            let hasItemsButNoVendor = false;

            if (ao.vendorSelections) {
                ao.vendorSelections.forEach((vs: any) => {
                    const itemCount = vs.items ? Object.keys(vs.items).filter(k => vs.items[k] > 0).length : 0;
                    if (vs.vendorId && itemCount === 0) hasVendorButNoItems = true;
                    if (!vs.vendorId && itemCount > 0) hasItemsButNoVendor = true;
                });
            }

            if (ao.mealSelections) {
                Object.values(ao.mealSelections).forEach((ms: any) => {
                    const itemCount = ms.items ? Object.keys(ms.items).filter((k: string) => ms.items[k] > 0).length : 0;
                    if (ms.vendorId && itemCount === 0) hasVendorButNoItems = true;
                    if (!ms.vendorId && itemCount > 0) hasItemsButNoVendor = true;
                });
            }

            if (hasVendorButNoItems) {
                console.log('   ISSUE FOUND: Has vendor selected but no items');
            }
            if (hasItemsButNoVendor) {
                console.log('   INFO: Has items without vendor (e.g., breakfast items) - this is OK');
            }
        }

        console.log('\n');
    }

    // Save full dump to file
    const dumpPath = path.resolve(process.cwd(), 'scripts/shloimy-klein-dump.json');
    const dumpData = {
        timestamp: new Date().toISOString(),
        clients: clientSearch,
        upcomingOrders: [] as any[]
    };

    for (const client of clientSearch) {
        const { data: uo } = await supabase
            .from('upcoming_orders')
            .select('*, upcoming_order_vendor_selections(*), upcoming_order_items(*), upcoming_order_box_selections(*)')
            .eq('client_id', client.id);
        if (uo) dumpData.upcomingOrders.push(...uo);
    }

    fs.writeFileSync(dumpPath, JSON.stringify(dumpData, null, 2));
    console.log(`Full data dump saved to: ${dumpPath}`);
}

investigateClient().catch(console.error);
