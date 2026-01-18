
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function run() {
    // The order we just created
    const orderId = '5c9dc293-ee28-44cd-a8c2-bcfa8fe6f34c';

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`\n=== 1. ORDERS Table (High Level Info) ===`);
    console.log(`ID: ${orderId}`);
    const { data: order } = await supabase.from('orders').select('id, client_id, total_value, total_items').eq('id', orderId).single();
    console.table(order);

    console.log(`\n=== 2. ORDER_VENDOR_SELECTIONS Table (Links Order to Vendor) ===`);
    const { data: vendorSelections } = await supabase.from('order_vendor_selections').select('id, order_id, vendor_id').eq('order_id', orderId);
    console.table(vendorSelections);

    if (vendorSelections && vendorSelections.length > 0) {
        const vsId = vendorSelections[0].id;
        console.log(`\n=== 3. ORDER_ITEMS Table (The Actual Items) ===`);
        console.log(`Searching for items where vendor_selection_id matches ${vsId}...`);

        const { data: items } = await supabase.from('order_items')
            .select('id, order_id, vendor_selection_id, menu_item_id, meal_item_id, quantity, total_value')
            .eq('vendor_selection_id', vsId);

        console.table(items);

        if (items && items.length > 0) {
            console.log(`\n--> MATCH EXPLAINED:`);
            console.log(`    Order ID (${orderId}) matches 'order_id' in Items.`);
            console.log(`    Vendor Selection ID (${vsId}) matches 'vendor_selection_id' in Items.`);
            console.log(`    Item Data is stored in 'order_items', NOT in the 'orders' table.`);
        }
    }
}

run();
