/**
 * Test script: verify the migrate-upcoming fetch gets hundreds of clients.
 * Run: npx tsx scripts/test-migrate-fetch.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as fs from 'fs';

// Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf-8');
    env.split('\n').forEach(line => {
        const m = line.match(/^([^=]+)=(.*)$/);
        if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
    });
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const clientSelect = `
    id, 
    full_name, 
    service_type, 
    active_order,
    upcoming_order,
    client_food_orders(id, delivery_day_orders, case_id),
    client_meal_orders(id, meal_selections, case_id),
    client_box_orders(id, box_type_id, quantity, vendor_id, items, item_notes, case_id)
`;

async function main() {
    console.log('=== Test 1: Simple clients count (no joins) ===');
    const { count: totalCount, error: countErr } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .is('parent_client_id', null);
    if (countErr) {
        console.error('Count error:', countErr);
        return;
    }
    console.log(`Total primary clients (parent_client_id null): ${totalCount}\n`);

    console.log('=== Test 2: Range pagination - clients with JOINs (migration query) ===');
    const PAGE_SIZE = 1000;
    let allClients: any[] = [];
    let page = 0;
    while (true) {
        const { data, error } = await supabase
            .from('clients')
            .select(clientSelect)
            .is('parent_client_id', null)
            .order('id', { ascending: true })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) {
            console.error('Error:', error);
            break;
        }
        const rows = data ?? [];
        console.log(`  Page ${page}: got ${rows.length} rows (range ${page * PAGE_SIZE}-${(page + 1) * PAGE_SIZE - 1})`);
        if (rows.length === 0) break;
        allClients.push(...rows);
        if (rows.length < PAGE_SIZE) break;
        page++;
    }
    console.log(`  TOTAL with joins: ${allClients.length}\n`);

    console.log('=== Test 3: Simple select (id only, no joins) - range 0-999 ===');
    const { data: simplePage, error: simpleErr } = await supabase
        .from('clients')
        .select('id')
        .is('parent_client_id', null)
        .order('id', { ascending: true })
        .range(0, 999);
    if (simpleErr) console.error('Error:', simpleErr);
    else console.log(`  Got ${simplePage?.length ?? 0} rows\n`);

    console.log('=== Test 4: clients.upcoming_order column (destination — exclude these) ===');
    const idsWithNewColumnFilled = new Set(
        allClients
            .filter(c => {
                const uo = (c as any).upcoming_order;
                return uo != null && typeof uo === 'object' && Object.keys(uo).length > 0 &&
                    (uo.serviceType || uo.caseId || uo.boxOrders || uo.deliveryDayOrders || uo.mealSelections);
            })
            .map(c => c.id)
    );
    console.log(`  Clients who already have clients.upcoming_order filled: ${idsWithNewColumnFilled.size}\n`);

    const migrationCandidates = allClients.filter(c => !idsWithNewColumnFilled.has(c.id));
    console.log(`=== Result: Migration candidates (clients without upcoming_order column filled): ${migrationCandidates.length} ===`);
}

main();
