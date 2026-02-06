/**
 * Confirm that deliveryDayOrders is no longer used — all clients migrated to vendorSelections.
 *
 * Uses hasLegacyDeliveryDayOrders: true if upcoming_order has deliveryDayOrders with content.
 * Exits 0 if migration complete (none use deliveryDayOrders), 1 otherwise.
 *
 * Run from project root:
 *   npx tsx scripts/confirm-deliveryDayOrders-migration.ts
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

async function main() {
    const { data: rows, error } = await supabase
        .from('clients')
        .select('id, full_name, upcoming_order');

    if (error) {
        console.error('Error fetching clients:', error.message);
        process.exit(1);
    }

    const clients = rows ?? [];
    const stillUsingDeliveryDayOrders: { id: string; full_name: string }[] = [];

    for (const row of clients) {
        const raw = row.upcoming_order;
        if (raw != null && typeof raw === 'object' && hasLegacyDeliveryDayOrders(raw)) {
            stillUsingDeliveryDayOrders.push({
                id: row.id,
                full_name: row.full_name || '(no name)'
            });
        }
    }

    if (stillUsingDeliveryDayOrders.length === 0) {
        console.log('✓ Migration confirmed: No clients use deliveryDayOrders. All use vendorSelections.');
        process.exit(0);
    }

    console.log(`✗ Migration incomplete: ${stillUsingDeliveryDayOrders.length} client(s) still use deliveryDayOrders:`);
    stillUsingDeliveryDayOrders.forEach((c) => console.log(`  ${c.id}  ${c.full_name}`));
    process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
