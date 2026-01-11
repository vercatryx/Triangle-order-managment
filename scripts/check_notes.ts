
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function checkOrderNotes(orderId: string) {
    console.log(`Checking items for order: ${orderId}`);

    const { data: items, error } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId);

    if (error) {
        console.error('Error fetching order items:', error);
        return;
    }

    if (!items || items.length === 0) {
        console.log('No items found for this order.');
        return;
    }

    console.log(`Found ${items.length} items:`);
    items.forEach((item, index) => {
        console.log(`Item ${index + 1}:`);
        console.log(`  ID: ${item.id}`);
        console.log(`  Menu Item ID: ${item.menu_item_id}`);
        console.log(`  Custom Name: ${item.custom_name}`);
        console.log(`  Quantity: ${item.quantity}`);
        console.log(`  Total Value: ${item.total_value}`);
        console.log(`  Notes: "${item.notes}"`); // Explicitly checking notes
        console.log('---');
    });
}

const orderIdToCheck = 'cc0d537c-d242-483e-a720-b7fddcbf3724';
checkOrderNotes(orderIdToCheck);
