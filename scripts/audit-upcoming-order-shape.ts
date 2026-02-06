/**
 * Audit script: check which clients have upcoming_order in old vs new shape.
 *
 * Old shape: deliveryDayOrders (day -> { vendorSelections: [] })
 * New shape: vendorSelections only (with itemsByDay, selectedDeliveryDays)
 *
 * Read-only - no writes.
 *
 * Run from project root:
 *   npx tsx scripts/audit-upcoming-order-shape.ts
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { hasLegacyDeliveryDayOrders } from '../lib/upcoming-order-converter';

const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
} else {
    dotenv.config();
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function hasVendorSelectionsWithFood(raw: any): boolean {
    if (!raw?.vendorSelections || !Array.isArray(raw.vendorSelections)) return false;
    return raw.vendorSelections.some(
        (s: any) =>
            s?.vendorId &&
            (s?.items && Object.keys(s.items || {}).length > 0) ||
            (s?.itemsByDay && Object.keys(s.itemsByDay || {}).length > 0)
    );
}

function isFoodOrMeal(raw: any): boolean {
    const st = raw?.serviceType ?? 'Food';
    return st === 'Food' || st === 'Meal';
}

async function main() {
    console.log('='.repeat(60));
    console.log('Audit: upcoming_order shape (deliveryDayOrders vs vendorSelections)');
    console.log('='.repeat(60));

    const { data: rows, error } = await supabase
        .from('clients')
        .select('id, full_name, service_type, upcoming_order');

    if (error) {
        console.error('Error fetching clients:', error.message);
        process.exit(1);
    }

    const clients = rows ?? [];
    const withUpcoming = clients.filter((c: any) => c.upcoming_order != null && typeof c.upcoming_order === 'object');
    const foodOrMealWithUpcoming = withUpcoming.filter((c: any) => isFoodOrMeal(c.upcoming_order));

    const legacy: { id: string; full_name: string }[] = [];
    const newShape: { id: string; full_name: string }[] = [];
    const both: { id: string; full_name: string }[] = [];
    const neither: { id: string; full_name: string }[] = [];

    for (const row of foodOrMealWithUpcoming) {
        const raw = row.upcoming_order as any;
        const hasLegacy = hasLegacyDeliveryDayOrders(raw);
        const hasNew = hasVendorSelectionsWithFood(raw);

        const entry = { id: row.id, full_name: row.full_name || '(no name)' };

        if (hasLegacy && hasNew) both.push(entry);
        else if (hasLegacy) legacy.push(entry);
        else if (hasNew) newShape.push(entry);
        else neither.push(entry);
    }

    console.log('\nSummary:');
    console.log('-'.repeat(60));
    console.log(`Total clients: ${clients.length}`);
    console.log(`Clients with upcoming_order: ${withUpcoming.length}`);
    console.log(`Food/Meal clients with upcoming_order: ${foodOrMealWithUpcoming.length}`);
    console.log('');
    console.log('Food/Meal upcoming_order shape:');
    console.log(`  OLD shape only (deliveryDayOrders): ${legacy.length}`);
    console.log(`  NEW shape only (vendorSelections):  ${newShape.length}`);
    console.log(`  BOTH (legacy + new):                ${both.length}`);
    console.log(`  NEITHER (no food selections):       ${neither.length}`);

    if (legacy.length > 0) {
        console.log('\n--- Clients with OLD shape (deliveryDayOrders) ---');
        legacy.forEach((c) => console.log(`  ${c.id}  ${c.full_name}`));
    }
    if (both.length > 0) {
        console.log('\n--- Clients with BOTH shapes ---');
        both.forEach((c) => console.log(`  ${c.id}  ${c.full_name}`));
    }
    if (legacy.length === 0 && both.length === 0) {
        console.log('\n✓ No clients in old shape (deliveryDayOrders). All Food/Meal use vendorSelections.');
    }

    console.log('\nDone.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
