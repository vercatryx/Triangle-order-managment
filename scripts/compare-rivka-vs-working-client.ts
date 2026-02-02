/**
 * Compare RIVKA MULLER's order data with CLIENT-523 (working client)
 * Run with: npx tsx scripts/compare-rivka-vs-working-client.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials. Check your .env.local file.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function getClientOrderData(clientId: string) {
    console.log(`\nFetching data for ${clientId}...`);
    
    // Get client
    const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();

    if (clientError || !client) {
        return { error: clientError?.message || 'Client not found', client: null };
    }

    const result: any = {
        client: {
            id: client.id,
            full_name: client.full_name,
            serviceType: client.serviceType,
            has_active_order: !!client.active_order,
            active_order_service_type: client.active_order?.serviceType,
            active_order_vendor_selections: client.active_order?.vendorSelections?.length || 0
        },
        upcoming_orders: [],
        analysis: {
            total_upcoming_orders: 0,
            orders_with_vendor_selections: 0,
            orders_without_vendor_selections: 0,
            total_vendor_selections: 0,
            total_items: 0,
            orphaned_items: 0
        }
    };

    // Get upcoming orders
    const { data: upcomingOrders, error: uoError } = await supabase
        .from('upcoming_orders')
        .select('*')
        .eq('client_id', clientId)
        .eq('status', 'scheduled')
        .order('created_at', { ascending: false });

    if (uoError) {
        result.error = uoError.message;
        return result;
    }

    result.analysis.total_upcoming_orders = upcomingOrders?.length || 0;

    if (!upcomingOrders || upcomingOrders.length === 0) {
        console.log(`  No upcoming orders found`);
        return result;
    }

    console.log(`  Found ${upcomingOrders.length} upcoming order(s)`);

    for (const order of upcomingOrders) {
        const orderData: any = {
            id: order.id,
            service_type: order.service_type,
            status: order.status,
            case_id: order.case_id,
            delivery_day: order.delivery_day,
            meal_type: order.meal_type,
            total_value: order.total_value,
            total_items: order.total_items,
            created_at: order.created_at,
            vendor_selections: [],
            all_items: [],
            orphaned_items: []
        };

        // Get vendor selections
        const { data: vendorSelections, error: vsError } = await supabase
            .from('upcoming_order_vendor_selections')
            .select('*')
            .eq('upcoming_order_id', order.id);

        if (!vsError && vendorSelections) {
            result.analysis.total_vendor_selections += vendorSelections.length;
            
            if (vendorSelections.length > 0) {
                result.analysis.orders_with_vendor_selections++;
                console.log(`    Order ${order.id.substring(0, 8)}... has ${vendorSelections.length} vendor selection(s)`);
            } else {
                result.analysis.orders_without_vendor_selections++;
                console.log(`    Order ${order.id.substring(0, 8)}... has NO vendor selections ⚠️`);
            }

            for (const vs of vendorSelections) {
                const vsData: any = {
                    id: vs.id,
                    vendor_id: vs.vendor_id,
                    vendor_id_is_null: vs.vendor_id === null || vs.vendor_id === '',
                    items: []
                };

                // Get items for this VS
                const { data: items, error: itemsError } = await supabase
                    .from('upcoming_order_items')
                    .select('*')
                    .eq('vendor_selection_id', vs.id);

                if (!itemsError && items) {
                    vsData.items = items;
                    result.analysis.total_items += items.length;
                    console.log(`      VS ${vs.id.substring(0, 8)}... has ${items.length} item(s), vendor_id: ${vs.vendor_id || 'NULL'}`);
                }

                orderData.vendor_selections.push(vsData);
            }
        } else {
            result.analysis.orders_without_vendor_selections++;
            console.log(`    Order ${order.id.substring(0, 8)}... has NO vendor selections ⚠️`);
        }

        // Get all items for this order (including orphaned)
        const { data: allItems, error: allItemsError } = await supabase
            .from('upcoming_order_items')
            .select('*')
            .eq('upcoming_order_id', order.id);

        if (!allItemsError && allItems) {
            orderData.all_items = allItems;
            orderData.orphaned_items = allItems.filter((item: any) => !item.vendor_selection_id);
            result.analysis.orphaned_items += orderData.orphaned_items.length;
            
            if (orderData.orphaned_items.length > 0) {
                console.log(`    ⚠️  Order has ${orderData.orphaned_items.length} ORPHANED items (not linked to vendor selection)`);
            }
        }

        result.upcoming_orders.push(orderData);
    }

    return result;
}

async function main() {
    console.log('='.repeat(80));
    console.log('COMPARING CLIENT ORDER DATA');
    console.log('='.repeat(80));

    const workingClientId = 'CLIENT-523';
    
    // Find RIVKA MULLER
    console.log('\nSearching for RIVKA MULLER...');
    const { data: rivkaClients, error: searchError } = await supabase
        .from('clients')
        .select('id, full_name')
        .or('full_name.ilike.%RIVKA%,full_name.ilike.%MULLER%')
        .limit(5);

    if (searchError) {
        console.error('Error searching for RIVKA MULLER:', searchError);
        return;
    }

    if (!rivkaClients || rivkaClients.length === 0) {
        console.log('❌ RIVKA MULLER not found');
        console.log('\nPlease provide the client ID manually as an argument');
        return;
    }

    console.log(`Found ${rivkaClients.length} client(s) matching RIVKA/MULLER:`);
    rivkaClients.forEach(c => console.log(`  - ${c.full_name} (${c.id})`));

    const rivkaClientId = rivkaClients[0].id;
    console.log(`\nUsing: ${rivkaClients[0].full_name} (${rivkaClientId})`);

    // Get data for both clients
    const [workingData, rivkaData] = await Promise.all([
        getClientOrderData(workingClientId),
        getClientOrderData(rivkaClientId)
    ]);

    // Print comparison
    console.log('\n' + '='.repeat(80));
    console.log('COMPARISON RESULTS');
    console.log('='.repeat(80));

    console.log(`\n📊 WORKING CLIENT (${workingClientId}):`);
    console.log(`   Name: ${workingData.client?.full_name}`);
    console.log(`   Service Type: ${workingData.client?.serviceType}`);
    console.log(`   Has Active Order: ${workingData.client?.has_active_order}`);
    console.log(`   Upcoming Orders: ${workingData.analysis.total_upcoming_orders}`);
    console.log(`   Orders with VS: ${workingData.analysis.orders_with_vendor_selections}`);
    console.log(`   Orders without VS: ${workingData.analysis.orders_without_vendor_selections}`);
    console.log(`   Total Vendor Selections: ${workingData.analysis.total_vendor_selections}`);
    console.log(`   Total Items: ${workingData.analysis.total_items}`);
    console.log(`   Orphaned Items: ${workingData.analysis.orphaned_items}`);

    console.log(`\n📊 PROBLEMATIC CLIENT (${rivkaClientId}):`);
    console.log(`   Name: ${rivkaData.client?.full_name}`);
    console.log(`   Service Type: ${rivkaData.client?.serviceType}`);
    console.log(`   Has Active Order: ${rivkaData.client?.has_active_order}`);
    console.log(`   Upcoming Orders: ${rivkaData.analysis.total_upcoming_orders}`);
    console.log(`   Orders with VS: ${rivkaData.analysis.orders_with_vendor_selections}`);
    console.log(`   Orders without VS: ${rivkaData.analysis.orders_without_vendor_selections}`);
    console.log(`   Total Vendor Selections: ${rivkaData.analysis.total_vendor_selections}`);
    console.log(`   Total Items: ${rivkaData.analysis.total_items}`);
    console.log(`   Orphaned Items: ${rivkaData.analysis.orphaned_items}`);

    // Identify issues
    console.log(`\n🔍 IDENTIFIED ISSUES:`);
    
    if (rivkaData.analysis.orders_without_vendor_selections > 0) {
        console.log(`   ❌ CRITICAL: ${rivkaData.analysis.orders_without_vendor_selections} order(s) have NO vendor selections`);
        console.log(`      This is why the order doesn't load in the client profile!`);
    }

    if (rivkaData.analysis.orphaned_items > 0) {
        console.log(`   ⚠️  WARNING: ${rivkaData.analysis.orphaned_items} orphaned item(s) exist`);
        console.log(`      Items are in the database but not linked to vendor selections`);
    }

    if (rivkaData.analysis.total_items > 0 && rivkaData.analysis.total_vendor_selections === 0) {
        console.log(`   ⚠️  WARNING: Items exist but no vendor selections to link them to`);
    }

    // Compare first orders
    const workingOrder = workingData.upcoming_orders[0];
    const rivkaOrder = rivkaData.upcoming_orders[0];

    if (workingOrder && rivkaOrder) {
        console.log(`\n📋 DETAILED COMPARISON (First Order):`);
        console.log(`\n   Working Order:`);
        console.log(`     ID: ${workingOrder.id}`);
        console.log(`     Service Type: ${workingOrder.service_type}`);
        console.log(`     Case ID: ${workingOrder.case_id}`);
        console.log(`     Vendor Selections: ${workingOrder.vendor_selections.length}`);
        workingOrder.vendor_selections.forEach((vs: any, i: number) => {
            console.log(`       VS ${i + 1}: vendor_id=${vs.vendor_id || 'NULL'}, items=${vs.items.length}`);
        });
        console.log(`     Total Items: ${workingOrder.all_items.length}`);

        console.log(`\n   Problematic Order:`);
        console.log(`     ID: ${rivkaOrder.id}`);
        console.log(`     Service Type: ${rivkaOrder.service_type}`);
        console.log(`     Case ID: ${rivkaOrder.case_id}`);
        console.log(`     Vendor Selections: ${rivkaOrder.vendor_selections.length}`);
        rivkaOrder.vendor_selections.forEach((vs: any, i: number) => {
            console.log(`       VS ${i + 1}: vendor_id=${vs.vendor_id || 'NULL'}, items=${vs.items.length}`);
        });
        console.log(`     Total Items: ${rivkaOrder.all_items.length}`);
        if (rivkaOrder.orphaned_items.length > 0) {
            console.log(`     Orphaned Items: ${rivkaOrder.orphaned_items.length}`);
        }
    }

    console.log(`\n💡 RECOMMENDATION:`);
    if (rivkaData.analysis.orders_without_vendor_selections > 0) {
        console.log(`   The order needs to be resaved to create vendor selections.`);
        console.log(`   The fix in lib/actions.ts should prevent this for new orders,`);
        console.log(`   but existing orders need to be deleted and recreated.`);
    } else {
        console.log(`   The order structure looks correct. Check the console logs`);
        console.log(`   when opening the client profile to see what getUpcomingOrderForClientLocal returns.`);
    }

    console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
