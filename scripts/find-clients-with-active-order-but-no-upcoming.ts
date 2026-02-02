/**
 * Find clients that have active_order in clients table but no upcoming_orders
 * Run with: npx tsx scripts/find-clients-with-active-order-but-no-upcoming.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials. Check your .env.local file.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function findClientsWithActiveOrderButNoUpcoming() {
    console.log('='.repeat(80));
    console.log('FINDING CLIENTS WITH active_order BUT NO upcoming_orders');
    console.log('='.repeat(80));
    console.log();

    // Get all clients with non-empty active_order
    console.log('Fetching clients with active_order...');
    const { data: clients, error: clientsError } = await supabase
        .from('clients')
        .select('id, full_name, service_type, active_order')
        .not('active_order', 'is', null);

    if (clientsError) {
        console.error('Error fetching clients:', clientsError);
        return;
    }

    if (!clients || clients.length === 0) {
        console.log('No clients with active_order found.');
        return;
    }

    console.log(`Found ${clients.length} clients with active_order`);
    console.log();

    // Filter out clients with empty active_order objects
    const clientsWithActiveOrder = clients.filter(c => {
        const ao = c.active_order;
        // Check if active_order is not null and not an empty object
        return ao && typeof ao === 'object' && Object.keys(ao).length > 0;
    });

    console.log(`After filtering empty active_order: ${clientsWithActiveOrder.length} clients`);
    console.log();

    // Check each client for upcoming_orders
    const problematicClients: any[] = [];

    for (const client of clientsWithActiveOrder) {
        const { data: upcomingOrders, error: uoError } = await supabase
            .from('upcoming_orders')
            .select('id, status')
            .eq('client_id', client.id)
            .eq('status', 'scheduled');

        if (uoError) {
            console.error(`Error checking upcoming_orders for ${client.id}:`, uoError);
            continue;
        }

        // If no upcoming orders found, this client has the discrepancy
        if (!upcomingOrders || upcomingOrders.length === 0) {
            const activeOrder = client.active_order as any;
            problematicClients.push({
                id: client.id,
                full_name: client.full_name,
                serviceType: client.service_type,
                active_order: {
                    serviceType: activeOrder?.serviceType,
                    caseId: activeOrder?.caseId,
                    hasVendorSelections: !!(activeOrder?.vendorSelections),
                    vendorSelectionsCount: activeOrder?.vendorSelections?.length || 0,
                    hasDeliveryDayOrders: !!(activeOrder?.deliveryDayOrders),
                    deliveryDayOrdersCount: activeOrder?.deliveryDayOrders ? Object.keys(activeOrder.deliveryDayOrders).length : 0,
                    hasMealSelections: !!(activeOrder?.mealSelections),
                    mealSelectionsCount: activeOrder?.mealSelections ? Object.keys(activeOrder.mealSelections).length : 0,
                    hasItems: !!(activeOrder?.items),
                    itemsCount: activeOrder?.items ? Object.keys(activeOrder.items).length : 0
                }
            });
        }
    }

    // Print results
    console.log('='.repeat(80));
    console.log(`RESULTS: ${problematicClients.length} clients with active_order but NO upcoming_orders`);
    console.log('='.repeat(80));
    console.log();

    if (problematicClients.length === 0) {
        console.log('✅ No discrepancies found! All clients with active_order have corresponding upcoming_orders.');
        return;
    }

    // Group by service type
    const byServiceType: Record<string, any[]> = {};
    problematicClients.forEach(c => {
        const st = c.serviceType || 'Unknown';
        if (!byServiceType[st]) byServiceType[st] = [];
        byServiceType[st].push(c);
    });

    console.log('Breakdown by Service Type:');
    Object.entries(byServiceType).forEach(([st, clients]) => {
        console.log(`  ${st}: ${clients.length}`);
    });
    console.log();

    // Print detailed list
    problematicClients.forEach((c, i) => {
        console.log(`${i + 1}. ${c.full_name} (${c.id})`);
        console.log(`   Service Type: ${c.serviceType || 'Unknown'}`);
        console.log(`   Active Order:`);
        console.log(`     - Service Type: ${c.active_order.serviceType || 'Unknown'}`);
        console.log(`     - Case ID: ${c.active_order.caseId || 'None'}`);
        console.log(`     - Vendor Selections: ${c.active_order.vendorSelectionsCount || 0}`);
        console.log(`     - Delivery Day Orders: ${c.active_order.deliveryDayOrdersCount || 0}`);
        console.log(`     - Meal Selections: ${c.active_order.mealSelectionsCount || 0}`);
        console.log(`     - Items: ${c.active_order.itemsCount || 0}`);
        console.log();
    });

    // Save to file
    const output = {
        generated_at: new Date().toISOString(),
        total_count: problematicClients.length,
        breakdown_by_service_type: Object.fromEntries(
            Object.entries(byServiceType).map(([st, clients]) => [st, clients.length])
        ),
        clients: problematicClients
    };

    const filename = `clients-with-active-order-but-no-upcoming-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.log(`\n✅ Results saved to: ${filename}`);
}

findClientsWithActiveOrderButNoUpcoming().catch(console.error);
