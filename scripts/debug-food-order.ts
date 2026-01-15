
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    console.log('Fetching most recent Food order...');

    const { data: order, error } = await supabase
        .from('orders')
        .select('*')
        .eq('service_type', 'Food')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        console.error('Error fetching order:', error);
        return;
    }

    if (!order) {
        console.log('No Food orders found.');
        return;
    }

    console.log('Found Order:', {
        id: order.id,
        order_number: order.order_number,
        service_type: order.service_type,
        created_at: order.created_at
    });

    console.log('\nFetching Vendor Selections...');
    const { data: vendorSelections, error: vsError } = await supabase
        .from('order_vendor_selections')
        .select('*')
        .eq('order_id', order.id);

    if (vsError) console.error('Error fetching selections:', vsError);
    console.log(`Found ${vendorSelections?.length || 0} selections:`, vendorSelections);

    if (vendorSelections && vendorSelections.length > 0) {
        for (const vs of vendorSelections) {
            console.log(`\nChecking Items for Vendor Selection ${vs.id}...`);
            const { data: items, error: iError } = await supabase
                .from('order_items')
                .select('*')
                .eq('vendor_selection_id', vs.id);

            if (iError) console.error('Error fetching items:', iError);
            console.log(`Found ${items?.length || 0} items:`, items);
        }
    } else {
        console.log('\nChecking for Orphaned Items (unexpected)...');
        // Check if items exist linked directly to order but missing validation selection linkage?
        // Logic in route.ts links them to VS.
        const { data: orphans } = await supabase.from('order_items').select('*').eq('order_id', order.id);
        console.log(`Total items for order ${order.id}: ${orphans?.length || 0}`);
    }
}

main().catch(console.error);
