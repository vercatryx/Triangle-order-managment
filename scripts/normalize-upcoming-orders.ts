/**
 * One-time migration: normalize all clients.upcoming_order to single shape (vendorSelections only).
 *
 * - Reads each client's upcoming_order, converts deliveryDayOrders → vendorSelections when present.
 * - Writes back only when the payload actually changed (deliveryDayOrders removed).
 *
 * Run from project root:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/normalize-upcoming-orders.ts
 * Or:
 *   npx tsx scripts/normalize-upcoming-orders.ts
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import {
    normalizeUpcomingOrder,
    hasLegacyDeliveryDayOrders
} from '../lib/upcoming-order-converter';

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

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
    console.log('='.repeat(60));
    console.log('Normalize upcoming_order: deliveryDayOrders → vendorSelections');
    console.log('='.repeat(60));

    const { data: rows, error } = await supabase
        .from('clients')
        .select('id, full_name, upcoming_order');

    if (error) {
        console.error('Error fetching clients:', error.message);
        process.exit(1);
    }

    const clients = rows ?? [];
    let withLegacy = 0;
    let updated = 0;
    const updatedIds: string[] = [];

    for (const row of clients) {
        const raw = row.upcoming_order as any;
        if (raw == null || typeof raw !== 'object') continue;

        if (hasLegacyDeliveryDayOrders(raw)) {
            withLegacy++;
        }

        const normalized = normalizeUpcomingOrder(raw);
        if (normalized == null) continue;

        if (!deepEqual(raw, normalized)) {
            const { error: updateError } = await supabase
                .from('clients')
                .update({
                    upcoming_order: normalized,
                    updated_at: new Date().toISOString()
                })
                .eq('id', row.id);

            if (updateError) {
                console.error(`Failed to update client ${row.id} (${row.full_name}):`, updateError.message);
                continue;
            }

            updated++;
            updatedIds.push(row.id);
            console.log(`  Updated ${row.id} (${row.full_name})`);
        }
    }

    console.log('\n' + '-'.repeat(60));
    console.log(`Clients with upcoming_order: ${clients.filter((c: any) => c.upcoming_order != null).length}`);
    console.log(`Clients with legacy deliveryDayOrders: ${withLegacy}`);
    console.log(`Clients updated (normalized): ${updated}`);
    if (updatedIds.length > 0) {
        console.log('Updated IDs:', updatedIds.join(', '));
    }
    console.log('Done.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
