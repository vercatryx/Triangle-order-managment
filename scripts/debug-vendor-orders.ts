
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const VENDOR_ID = '1e9e2218-fdff-434f-b279-93d9d7bf4bd2';

async function debugVendorOrders() {
    console.log(`Checking orders for vendor: ${VENDOR_ID}`);

    // 1. Check order_vendor_selections
    const { data: selections, error: selError } = await supabase
        .from('order_vendor_selections')
        .select('*')
        .eq('vendor_id', VENDOR_ID);

    if (selError) {
        console.error('Error fetching selections:', selError);
        return;
    }

    console.log(`Found ${selections.length} vendor selections.`);
    if (selections.length === 0) {
        console.log('No vendor selections found. Checking boxes...');
    }

    // 2. Check order_box_selections
    const { data: boxSelections, error: boxError } = await supabase
        .from('order_box_selections')
        .select('*')
        .eq('vendor_id', VENDOR_ID);

    if (boxError) {
        console.error('Error fetching box selections:', boxError);
        return;
    }
    console.log(`Found ${boxSelections.length} box selections.`);

    const orderIds = Array.from(new Set([
        ...selections.map(s => s.order_id),
        ...boxSelections.map(s => s.order_id)
    ]));

    console.log(`Total unique Order IDs linked: ${orderIds.length}`);

    if (orderIds.length > 0) {
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('*')
            .in('id', orderIds);

        if (ordersError) {
            console.error('Error fetching orders:', ordersError);
        } else {
            console.log(`Fetched ${orders.length} orders from orders table.`);
            orders.forEach(o => {
                console.log(`- Order ${o.id} | Type: ${o.service_type} | Number: ${o.order_number}`);
            });
        }
    }
}

debugVendorOrders();
