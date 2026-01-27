/**
 * Diagnostic script: trace why getAllOrders vendor names always show "Unknown".
 * Run: npx tsx scripts/debug_getAllOrders_vendors.ts
 */
import 'dotenv/config';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

async function run() {
    console.log('=== 1. ORDERS (same filter as getAllOrders) ===');
    const { data: orders, error: ordersErr } = await db
        .from('orders')
        .select('id, order_number, service_type, client_id')
        .neq('status', 'billing_pending')
        .not('scheduled_delivery_date', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20);

    if (ordersErr) {
        console.error('Orders error:', ordersErr);
        return;
    }
    console.log(`Count: ${orders?.length ?? 0}`);
    if (orders?.length) {
        console.log('Sample IDs:', orders.slice(0, 3).map((o: any) => o.id));
        console.log('Sample:', orders[0]);
    }

    const orderIds = (orders || []).map((o: any) => o.id);
    if (orderIds.length === 0) {
        console.log('No orders. Exiting.');
        return;
    }

    console.log('\n=== 2. ORDER_VENDOR_SELECTIONS (order_id, vendor_id) ===');
    const { data: ovs, error: ovsErr } = await db
        .from('order_vendor_selections')
        .select('order_id, vendor_id')
        .in('order_id', orderIds);

    console.log('OVS error:', ovsErr?.message ?? null);
    console.log('OVS count:', ovs?.length ?? 0);
    if (ovs?.length) {
        console.log('Sample OVS:', ovs.slice(0, 5));
        const vids = [...new Set((ovs as any[]).map((r) => r.vendor_id).filter(Boolean))];
        console.log('Unique vendor_ids in OVS:', vids.length, vids.slice(0, 3));
    }

    console.log('\n=== 3. ORDER_BOX_SELECTIONS (order_id, vendor_id) ===');
    const { data: obs, error: obsErr } = await db
        .from('order_box_selections')
        .select('order_id, vendor_id')
        .in('order_id', orderIds);

    console.log('OBS error:', obsErr?.message ?? null);
    console.log('OBS count:', obs?.length ?? 0);
    if (obs?.length) {
        console.log('Sample OBS:', obs.slice(0, 5));
    }

    const allVendorIds = new Set<string>();
    (ovs || []).forEach((r: any) => { if (r.vendor_id) allVendorIds.add(r.vendor_id); });
    (obs || []).forEach((r: any) => { if (r.vendor_id) allVendorIds.add(r.vendor_id); });
    const vendorIds = Array.from(allVendorIds);
    console.log('\n=== 4. Unique vendor_ids from OVS+OBS ===');
    console.log('Count:', vendorIds.length);
    console.log('IDs:', vendorIds.slice(0, 5));

    console.log('\n=== 5. VENDORS (id, name) by those ids ===');
    if (vendorIds.length === 0) {
        console.log('No vendor IDs to look up.');
    } else {
        const { data: vendors, error: vErr } = await db
            .from('vendors')
            .select('id, name')
            .in('id', vendorIds);

        console.log('Vendors error:', vErr?.message ?? null);
        console.log('Vendors count:', vendors?.length ?? 0);
        if (vendors?.length) {
            console.log('Sample vendors:', vendors.slice(0, 5));
        }
    }

    console.log('\n=== 6. VENDORS table total (id, name) - first 5 ===');
    const { data: allV, error: allVErr } = await db.from('vendors').select('id, name').limit(5);
    console.log('Error:', allVErr?.message ?? null);
    console.log('Sample:', allV);

    console.log('\n=== 7. getVendors-style fetch (anon key) ===');
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (anonKey) {
        const anon = createClient(supabaseUrl, anonKey);
        const { data: gv, error: gvErr } = await anon.from('vendors').select('id, name');
        console.log('getVendors-style error:', gvErr?.message ?? null);
        console.log('getVendors-style count:', gv?.length ?? 0);
        if (gvErr) console.log('Full error:', gvErr);
    }
}

run().catch(console.error);
