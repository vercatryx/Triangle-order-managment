/**
 * Debug why order 38d32648-5551-445e-90c9-ca662a8d3727 shows no details (only total).
 * Run: npx tsx scripts/debug-order-detail-38d32648.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const ORDER_ID = '38d32648-5551-445e-90c9-ca662a8d3727';

async function run() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('=== Order row (orders) ===');
    const { data: orderRow, error: orderErr } = await supabase
        .from('orders')
        .select('*')
        .eq('id', ORDER_ID)
        .single();

    if (orderErr) {
        console.error('Order fetch error:', orderErr);
        return;
    }
    if (!orderRow) {
        console.error('Order not found.');
        return;
    }

    console.log('id:', orderRow.id);
    console.log('order_number:', orderRow.order_number);
    console.log('client_id:', orderRow.client_id);
    console.log('service_type:', orderRow.service_type);
    console.log('total_value:', orderRow.total_value);
    console.log('total_items:', orderRow.total_items);
    console.log('status:', orderRow.status);
    console.log('notes (orders.notes):', orderRow.notes ?? '(null/undefined)');
    console.log('orders table columns that contain "note":', Object.keys(orderRow).filter(k => k.toLowerCase().includes('note')));
    console.log('');

    console.log('=== order_vendor_selections for this order_id ===');
    const { data: vendorSelections, error: vsErr } = await supabase
        .from('order_vendor_selections')
        .select('*')
        .eq('order_id', ORDER_ID);

    if (vsErr) {
        console.error('order_vendor_selections error:', vsErr);
    } else {
        console.log('Count:', vendorSelections?.length ?? 0);
        if (vendorSelections?.length) {
            console.log('Rows:', JSON.stringify(vendorSelections, null, 2));
        }
    }
    console.log('');

    if (vendorSelections?.length) {
        for (const vs of vendorSelections) {
            console.log(`=== order_items for vendor_selection_id ${vs.id} ===`);
            const { data: items, error: itemsErr } = await supabase
                .from('order_items')
                .select('*')
                .eq('vendor_selection_id', vs.id);
            if (itemsErr) console.error('order_items error:', itemsErr);
            else console.log('Count:', items?.length ?? 0, items?.length ? 'Sample: ' + JSON.stringify(items[0]) : '');
            console.log('');
        }
    }

    // Check order_items with order_id if column exists
    console.log('=== order_items by order_id (if column exists) ===');
    const { data: itemsByOrderId, error: itemsByOrderErr } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', ORDER_ID);
    if (itemsByOrderErr) {
        console.log('(order_items may not have order_id column)', itemsByOrderErr.message);
    } else {
        console.log('Count:', itemsByOrderId?.length ?? 0);
        if (itemsByOrderId?.length) console.log('Sample:', itemsByOrderId[0]);
    }
    console.log('');

    // order_box_selections for Boxes (fetch as list to support multiple rows)
    if (orderRow.service_type === 'Boxes') {
        console.log('=== order_box_selections for this order_id ===');
        const { data: boxSels, error: boxErr } = await supabase
            .from('order_box_selections')
            .select('*')
            .eq('order_id', ORDER_ID);
        if (boxErr) console.error('order_box_selections error:', boxErr);
        else {
            console.log('Count:', boxSels?.length ?? 0);
            console.log('Columns in first row:', boxSels?.length ? Object.keys(boxSels[0]) : []);
            boxSels?.forEach((b: any, i: number) => {
                console.log(`  Box ${i + 1}: vendor_id=${b.vendor_id}, box_type_id=${b.box_type_id}, quantity=${b.quantity}, total_value=${b.total_value}, items keys=${Object.keys(b.items || {}).length}`);
                console.log('  Item IDs:', Object.keys(b.items || {}));
                if (b.item_notes != null) {
                    console.log('  item_notes:', JSON.stringify(b.item_notes));
                } else {
                    console.log('  item_notes: (column missing or null)');
                }
            });
            if (boxSels?.length) console.log('Full first box row (for item_notes etc):', JSON.stringify(boxSels[0], null, 2));
        }
        console.log('');
    }

    // getOrderById result
    console.log('=== getOrderById result (orderDetails only) ===');
    const { getOrderById } = await import('../lib/actions');
    const fullOrder = await getOrderById(ORDER_ID);
    if (fullOrder) {
        console.log('notes (getOrderById):', fullOrder.notes ?? '(null/undefined)');
        console.log('orderDetails present:', !!fullOrder.orderDetails);
        if (fullOrder.orderDetails) {
            console.log('orderDetails.serviceType:', fullOrder.orderDetails.serviceType);
            if (fullOrder.orderDetails.vendorSelections) {
                console.log('orderDetails.vendorSelections.length:', fullOrder.orderDetails.vendorSelections.length);
            }
            console.log('orderDetails:', JSON.stringify(fullOrder.orderDetails, null, 2));
        } else {
            console.log('orderDetails is undefined – so detail view shows no line items.');
        }
    } else {
        console.log('getOrderById returned null.');
    }
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
