/**
 * Debug order c515fc0f-56db-4619-b392-bf1727ae8b4e for vendor page (two boxes, notes).
 * Run: npx tsx scripts/debug-vendor-order-c515fc0f.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const ORDER_ID = 'c515fc0f-56db-4619-b392-bf1727ae8b4e';
const VENDOR_ID = '8ab80cd7-a0a2-4257-9768-7123c57d260b';

async function run() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('Missing env');
        process.exit(1);
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('=== Order row ===');
    const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('id, order_number, client_id, service_type, scheduled_delivery_date')
        .eq('id', ORDER_ID)
        .single();
    if (orderErr || !order) {
        console.error('Order error:', orderErr);
        return;
    }
    console.log(order);
    console.log('');

    console.log('=== order_box_selections (all for this order) ===');
    const { data: boxRows, error: boxErr } = await supabase
        .from('order_box_selections')
        .select('*')
        .eq('order_id', ORDER_ID);
    if (boxErr) {
        console.error('Box selections error:', boxErr);
        return;
    }
    console.log('Count:', boxRows?.length ?? 0);
    boxRows?.forEach((row: any, i: number) => {
        console.log(`\n--- Box ${i + 1} (id: ${row.id}) ---`);
        console.log('  vendor_id:', row.vendor_id);
        console.log('  quantity:', row.quantity);
        console.log('  total_value:', row.total_value);
        console.log('  items type:', typeof row.items);
        console.log('  items:', JSON.stringify(row.items, null, 2));
        console.log('  item_notes type:', typeof row.item_notes);
        console.log('  item_notes:', row.item_notes == null ? 'null/undefined' : JSON.stringify(row.item_notes, null, 2));
    });
    console.log('');

    console.log('=== Simulate processVendorOrderDetails (vendor_id filter) ===');
    const { data: boxForVendor } = await supabase
        .from('order_box_selections')
        .select('*')
        .eq('order_id', ORDER_ID)
        .eq('vendor_id', VENDOR_ID);
    console.log('Rows for this vendor:', boxForVendor?.length ?? 0);
    if (boxForVendor?.length) {
        let mergedItems: Record<string, number> = {};
        let mergedNotes: Record<string, string> = {};
        for (const bs of boxForVendor) {
            const items = typeof bs.items === 'string' ? (() => { try { return JSON.parse(bs.items); } catch { return {}; } })() : (bs.items || {});
            Object.entries(items).forEach(([itemId, qty]: [string, any]) => {
                const n = typeof qty === 'object' && qty != null && 'quantity' in qty ? Number((qty as any).quantity) : Number(qty) || 0;
                mergedItems[itemId] = (mergedItems[itemId] || 0) + n;
            });
            const notes = typeof bs.item_notes === 'string' ? (() => { try { return JSON.parse(bs.item_notes); } catch { return {}; } })() : (bs.item_notes || {});
            Object.assign(mergedNotes, notes);
        }
        console.log('Merged items:', JSON.stringify(mergedItems, null, 2));
        console.log('Merged item_notes:', JSON.stringify(mergedNotes, null, 2));
    }
}

run().catch((e) => { console.error(e); process.exit(1); });
