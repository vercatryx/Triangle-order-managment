/**
 * Migrate all clients.upcoming_order to vendorSelections-only (no deliveryDayOrders).
 *
 * - Converts deliveryDayOrders → vendorSelections when present (using deliveryDayOrdersToVendorSelections)
 * - Strips deliveryDayOrders from all clients — we no longer support the old format
 * - Writes back only when the payload changed
 *
 * Run from project root:
 *   npx tsx scripts/migrate-to-vendorSelections-only.ts
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

/** Ensure payload has no deliveryDayOrders key at all */
function stripDeliveryDayOrders(payload: Record<string, any>): Record<string, any> {
    if (!payload || typeof payload !== 'object') return payload;
    const out = { ...payload };
    if ('deliveryDayOrders' in out) {
        delete out.deliveryDayOrders;
    }
    return out;
}

async function main() {
    console.log('='.repeat(60));
    console.log('Migrate upcoming_order to vendorSelections-only (drop deliveryDayOrders)');
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

        // Ensure no deliveryDayOrders key remains (belt-and-suspenders)
        const final = stripDeliveryDayOrders(normalized as Record<string, any>);

        if (!deepEqual(raw, final)) {
            const { error: updateError } = await supabase
                .from('clients')
                .update({
                    upcoming_order: final,
                    updated_at: new Date().toISOString()
                })
                .eq('id', row.id);

            if (updateError) {
                console.error(`Failed to update client ${row.id} (${row.full_name}):`, updateError.message);
                continue;
            }

            updated++;
            updatedIds.push(row.id);
            console.log(`  Migrated ${row.id} (${row.full_name})`);
        }
    }

    console.log('\n' + '-'.repeat(60));
    console.log(`Clients with upcoming_order: ${clients.filter((c: any) => c.upcoming_order != null).length}`);
    console.log(`Clients that had deliveryDayOrders: ${withLegacy}`);
    console.log(`Clients migrated/updated: ${updated}`);
    if (updatedIds.length > 0) {
        console.log('Updated IDs:', updatedIds.join(', '));
    }
    if (updated === 0 && withLegacy === 0) {
        console.log('\n✓ No migration needed — all clients already use vendorSelections only.');
    } else if (updated > 0) {
        console.log('\n✓ Migration complete.');
    }
    console.log('Done.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
