import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface OrderDetail {
    id: string;
    client_id: string;
    service_type: string;
    status: string;
    delivery_day: string | null;
    notes: string | null;
    total_value: number | null;
    total_items: number | null;
    case_id: string | null;
    created_at: string;
    last_updated: string | null;
}

/**
 * Cleanup script to remove duplicate upcoming orders.
 * 
 * IMPORTANT: This script ONLY modifies upcoming_orders table and related tables.
 * It does NOT touch the orders table (actual processed orders).
 * 
 * This script:
 * 1. Finds clients with multiple upcoming orders
 * 2. For clients with Custom orders, removes any Food/Box/Meal orders
 * 3. Provides detailed report on each order deleted
 */
async function cleanupDuplicateUpcomingOrders() {
    console.log('='.repeat(80));
    console.log('CLEANUP SCRIPT: Duplicate Upcoming Orders');
    console.log('='.repeat(80));
    console.log('NOTE: This script ONLY modifies upcoming_orders table.');
    console.log('      It does NOT touch the orders table (actual processed orders).\n');

    // 1. Get all non-processed upcoming orders with full details
    const { data: allOrders, error: fetchError } = await supabase
        .from('upcoming_orders')
        .select('id, client_id, service_type, status, delivery_day, notes, total_value, total_items, case_id, created_at, last_updated')
        .neq('status', 'processed')
        .order('client_id')
        .order('created_at', { ascending: false });

    if (fetchError) {
        console.error('Error fetching upcoming orders:', fetchError);
        return;
    }

    if (!allOrders || allOrders.length === 0) {
        console.log('No upcoming orders found.');
        return;
    }

    console.log(`Found ${allOrders.length} total upcoming orders.\n`);

    // 2. Get client names for better reporting
    const clientIds = [...new Set(allOrders.map(o => o.client_id))];
    const { data: clients } = await supabase
        .from('clients')
        .select('id, full_name')
        .in('id', clientIds);
    
    const clientNameMap = new Map<string, string>();
    if (clients) {
        clients.forEach(c => clientNameMap.set(c.id, c.full_name));
    }

    // 3. Group orders by client_id
    const ordersByClient = new Map<string, OrderDetail[]>();
    for (const order of allOrders as OrderDetail[]) {
        if (!ordersByClient.has(order.client_id)) {
            ordersByClient.set(order.client_id, []);
        }
        ordersByClient.get(order.client_id)!.push(order);
    }

    // 4. Find clients with multiple orders or clients with Custom + other types
    const clientsToCleanup: Array<{
        clientId: string;
        clientName: string;
        orders: OrderDetail[];
        customOrders: OrderDetail[];
        otherOrders: OrderDetail[];
    }> = [];

    for (const [clientId, orders] of ordersByClient.entries()) {
        if (orders.length > 1) {
            const customOrders = orders.filter(o => o.service_type === 'Custom');
            const otherOrders = orders.filter(o => o.service_type !== 'Custom');
            
            // If client has Custom orders AND other types, we need to clean up
            if (customOrders.length > 0 && otherOrders.length > 0) {
                clientsToCleanup.push({
                    clientId,
                    clientName: clientNameMap.get(clientId) || 'Unknown',
                    orders,
                    customOrders,
                    otherOrders
                });
            }
        }
    }

    if (clientsToCleanup.length === 0) {
        console.log('✓ No duplicate orders found that need cleanup.');
        return;
    }

    console.log(`\nFound ${clientsToCleanup.length} clients with duplicate orders:\n`);
    console.log('-'.repeat(80));

    // 5. Detailed report of what will be deleted
    const ordersToDelete: Array<{ order: OrderDetail; clientName: string }> = [];
    
    for (const { clientId, clientName, customOrders, otherOrders } of clientsToCleanup) {
        console.log(`\nClient: ${clientName} (ID: ${clientId})`);
        console.log(`  Custom orders (KEEPING): ${customOrders.length}`);
        customOrders.forEach(o => {
            console.log(`    - Order ${o.id}: ${o.service_type} | Delivery: ${o.delivery_day || 'N/A'} | Value: $${o.total_value || 0} | Notes: ${o.notes || 'N/A'}`);
        });
        console.log(`  Other orders (DELETING): ${otherOrders.length}`);
        otherOrders.forEach(o => {
            console.log(`    - Order ${o.id}: ${o.service_type} | Delivery: ${o.delivery_day || 'N/A'} | Value: $${o.total_value || 0} | Notes: ${o.notes || 'N/A'}`);
            ordersToDelete.push({ order: o, clientName });
        });
    }

    console.log('\n' + '='.repeat(80));
    console.log(`SUMMARY: Will delete ${ordersToDelete.length} upcoming order(s) from ${clientsToCleanup.length} client(s)`);
    console.log('='.repeat(80) + '\n');

    // 6. Start cleanup
    console.log('Starting cleanup...\n');

    let totalDeleted = 0;
    let totalErrors = 0;
    const deletedOrders: Array<{ order: OrderDetail; clientName: string }> = [];

    // 7. Delete the non-Custom orders and their related data
    for (const { clientId, clientName, otherOrders } of clientsToCleanup) {
        const orderIds = otherOrders.map(o => o.id);
        
        console.log(`\nProcessing: ${clientName} (${clientId})`);
        console.log(`  Deleting ${orderIds.length} order(s)...`);

        // Report each order being deleted
        otherOrders.forEach(order => {
            console.log(`    DELETING Order ${order.id}:`);
            console.log(`      - Service Type: ${order.service_type}`);
            console.log(`      - Delivery Day: ${order.delivery_day || 'N/A'}`);
            console.log(`      - Total Value: $${order.total_value || 0}`);
            console.log(`      - Total Items: ${order.total_items || 0}`);
            console.log(`      - Case ID: ${order.case_id || 'N/A'}`);
            console.log(`      - Notes: ${order.notes || 'N/A'}`);
            console.log(`      - Created: ${order.created_at}`);
            console.log(`      - Last Updated: ${order.last_updated || 'N/A'}`);
        });

        try {
            // Delete related items/selections first (to avoid FK constraints)
            const [itemsResult, vendorSelectionsResult, boxSelectionsResult] = await Promise.all([
                supabase.from('upcoming_order_items').delete().in('upcoming_order_id', orderIds),
                supabase.from('upcoming_order_vendor_selections').delete().in('upcoming_order_id', orderIds),
                supabase.from('upcoming_order_box_selections').delete().in('upcoming_order_id', orderIds)
            ]);

            let relatedDataDeleted = 0;
            if (itemsResult.error) {
                console.error(`      ✗ Error deleting items: ${itemsResult.error.message}`);
                totalErrors++;
            } else if (itemsResult.data && Array.isArray(itemsResult.data)) {
                relatedDataDeleted += (itemsResult.data as unknown[]).length || 0;
            }
            if (vendorSelectionsResult.error) {
                console.error(`      ✗ Error deleting vendor selections: ${vendorSelectionsResult.error.message}`);
                totalErrors++;
            } else if (vendorSelectionsResult.data && Array.isArray(vendorSelectionsResult.data)) {
                relatedDataDeleted += (vendorSelectionsResult.data as unknown[]).length || 0;
            }
            if (boxSelectionsResult.error) {
                console.error(`      ✗ Error deleting box selections: ${boxSelectionsResult.error.message}`);
                totalErrors++;
            } else if (boxSelectionsResult.data && Array.isArray(boxSelectionsResult.data)) {
                relatedDataDeleted += (boxSelectionsResult.data as unknown[]).length || 0;
            }

            if (relatedDataDeleted > 0) {
                console.log(`      ✓ Deleted ${relatedDataDeleted} related record(s) (items/selections)`);
            }

            // Delete the upcoming orders
            const { error: deleteError } = await supabase
                .from('upcoming_orders')
                .delete()
                .in('id', orderIds);

            if (deleteError) {
                console.error(`      ✗ Error deleting orders: ${deleteError.message}`);
                totalErrors++;
            } else {
                console.log(`      ✓ Successfully deleted ${orderIds.length} upcoming order(s)`);
                totalDeleted += orderIds.length;
                otherOrders.forEach(o => deletedOrders.push({ order: o, clientName }));
            }
        } catch (error: any) {
            console.error(`      ✗ Error processing client ${clientId}:`, error.message);
            totalErrors++;
        }
    }

    // 8. Final detailed report
    console.log('\n' + '='.repeat(80));
    console.log('CLEANUP COMPLETE - DETAILED REPORT');
    console.log('='.repeat(80));
    console.log(`\nTotal upcoming orders deleted: ${totalDeleted}`);
    console.log(`Total errors: ${totalErrors}`);
    console.log(`Clients cleaned: ${clientsToCleanup.length}`);
    
    if (deletedOrders.length > 0) {
        console.log('\n--- DELETED ORDERS DETAIL ---');
        deletedOrders.forEach(({ order, clientName }, index) => {
            console.log(`\n${index + 1}. Client: ${clientName} (${order.client_id})`);
            console.log(`   Order ID: ${order.id}`);
            console.log(`   Service Type: ${order.service_type}`);
            console.log(`   Delivery Day: ${order.delivery_day || 'N/A'}`);
            console.log(`   Total Value: $${order.total_value || 0}`);
            console.log(`   Total Items: ${order.total_items || 0}`);
            console.log(`   Case ID: ${order.case_id || 'N/A'}`);
            console.log(`   Notes: ${order.notes || 'N/A'}`);
            console.log(`   Created: ${order.created_at}`);
            console.log(`   Last Updated: ${order.last_updated || 'N/A'}`);
        });
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('NOTE: Only upcoming_orders table was modified.');
    console.log('      The orders table (actual processed orders) was NOT touched.');
    console.log('='.repeat(80));
}

cleanupDuplicateUpcomingOrders()
    .then(() => {
        console.log('\nCleanup completed.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
