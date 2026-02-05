/**
 * Remove meal types that no longer exist (e.g. "Lunch" after it was deleted from breakfast_categories).
 *
 * Valid meal types are taken from breakfast_categories.meal_type.
 *
 * 1. client_meal_orders: removes invalid keys from meal_selections JSONB.
 *    Keys like "Triangle Breakfast/Lunch (12 Meals)_1769013859097" are kept (valid type + _timestamp for multiple blocks).
 * 2. upcoming_orders: sets meal_type to null when it's invalid (avoids duplicate unique key).
 *
 * Usage:
 *   npx ts-node scripts/remove-invalid-meal-types.ts           # remove all invalid meal types
 *   npx ts-node scripts/remove-invalid-meal-types.ts --dry-run  # report only, no writes
 *   npx ts-node scripts/remove-invalid-meal-types.ts --only Lunch  # only remove "Lunch" (even if still in DB)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const isDryRun = process.argv.includes('--dry-run');
const onlyIdx = process.argv.indexOf('--only');
const onlyRemove: string | null = onlyIdx >= 0 && process.argv[onlyIdx + 1]
    ? process.argv[onlyIdx + 1].trim()
    : null;

async function getValidMealTypes(): Promise<string[]> {
    const { data, error } = await supabase
        .from('breakfast_categories')
        .select('meal_type');
    if (error) {
        console.error('Error fetching meal types from breakfast_categories:', error);
        throw error;
    }
    const types = [...new Set((data || []).map((r: any) => r.meal_type).filter(Boolean))].sort();
    return types;
}

/**
 * For upcoming_orders.meal_type: returns null if invalid; otherwise leaves value as-is (we do not normalize "validType_timestamp" to "validType" so each row keeps its reference).
 */
function normalizeUpcomingMealType(mealType: string, validTypes: string[]): string | null {
    if (onlyRemove) return (mealType === onlyRemove || mealType.startsWith(onlyRemove + '_')) ? null : mealType;
    if (validTypes.includes(mealType)) return mealType;
    for (const vt of validTypes) {
        if (mealType.startsWith(vt + '_')) return mealType; // keep as-is (valid type + timestamp), don't strip timestamp
    }
    return null;
}

/**
 * True if this meal selection KEY (in client_meal_orders.meal_selections) is invalid.
 * Keys can be exact meal type or "mealType_timestamp" (UI uses that for multiple blocks of same type).
 */
function isInvalidSelectionKey(key: string, validTypes: string[]): boolean {
    if (onlyRemove) {
        return key === onlyRemove || key.startsWith(onlyRemove + '_');
    }
    if (validTypes.includes(key)) return false;
    for (const vt of validTypes) {
        if (key.startsWith(vt + '_')) return false; // e.g. "Triangle Breakfast/Lunch (12 Meals)_1769013859097"
    }
    return true;
}

async function main() {
    console.log('='.repeat(60));
    console.log('Remove invalid meal types');
    console.log('='.repeat(60));
    if (isDryRun) console.log('DRY RUN – no changes will be written.\n');
    if (onlyRemove) console.log(`Only removing meal type: "${onlyRemove}"\n`);

    const validMealTypes = await getValidMealTypes();
    console.log('Valid meal types (from breakfast_categories):', validMealTypes.length ? validMealTypes.join(', ') : '(none)');
    if (validMealTypes.length === 0 && !onlyRemove) {
        console.log('No valid meal types found. Exiting.');
        return;
    }

    // --- client_meal_orders ---
    const { data: mealOrders, error: mealErr } = await supabase
        .from('client_meal_orders')
        .select('id, client_id, meal_selections');
    if (mealErr) {
        console.error('Error fetching client_meal_orders:', mealErr);
        return;
    }

    let clientMealUpdates = 0;
    for (const row of mealOrders || []) {
        const selections = (row.meal_selections as Record<string, unknown>) || {};
        const keys = Object.keys(selections);
        const toRemove = keys.filter((k) => isInvalidSelectionKey(k, validMealTypes));
        if (toRemove.length === 0) continue;

        const next: Record<string, unknown> = {};
        for (const k of keys) {
            if (!toRemove.includes(k)) next[k] = selections[k];
        }
        clientMealUpdates++;
        console.log(`  client_meal_orders ${row.id} (client ${row.client_id}): removing keys [${toRemove.join(', ')}]`);
        if (!isDryRun) {
            const { error: upd } = await supabase
                .from('client_meal_orders')
                .update({ meal_selections: Object.keys(next).length ? next : null })
                .eq('id', row.id);
            if (upd) console.error('    Update error:', upd);
        }
    }
    console.log(`\nclient_meal_orders: ${clientMealUpdates} row(s) ${isDryRun ? 'would be ' : ''}updated.`);

    // --- upcoming_orders (meal_type column) ---
    const { data: upcoming, error: upErr } = await supabase
        .from('upcoming_orders')
        .select('id, client_id, service_type, delivery_day, meal_type');
    if (upErr) {
        console.error('Error fetching upcoming_orders:', upErr);
        return;
    }

    const upcomingRows = (upcoming || []).filter((r: any) => r.meal_type != null);
    let upcomingUpdates = 0;
    for (const row of upcomingRows) {
        const current = String(row.meal_type);
        const normalized = normalizeUpcomingMealType(current, validMealTypes);
        if (normalized === current) continue; // no change
        upcomingUpdates++;
        console.log(`  upcoming_orders ${row.id} (client ${row.client_id}, ${row.service_type}): meal_type "${row.meal_type}" -> ${normalized ?? 'null'}`);
        if (!isDryRun) {
            const { error: upd } = await supabase
                .from('upcoming_orders')
                .update({ meal_type: normalized })
                .eq('id', row.id);
            if (upd) console.error('    Update error:', upd);
        }
    }
    console.log(`\nupcoming_orders: ${upcomingUpdates} row(s) with invalid meal_type ${isDryRun ? 'would be ' : ''}updated.`);

    console.log('\nDone.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
