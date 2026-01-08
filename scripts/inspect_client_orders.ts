
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function inspectClient() {
    // 1. Find all clients to see what ID format is used
    const { data: clients, error: clientError } = await supabase
        .from('clients')
        .select('id, full_name')
        .eq('id', 'CLIENT-247')
        .limit(1);

    console.log("Recent clients:", clients);

    if (clientError || !clients?.length) {
        console.error("Client fetch error:", clientError);
        return;
    }

    const client = clients[0];
    console.log("Found Client:", { id: client.id, name: client.full_name });

    // 2. Find upcoming orders
    const { data: orders, error: orderError } = await supabase
        .from('upcoming_orders')
        .select('*')
        .eq('client_id', client.id);

    if (orderError) {
        console.error("Order fetch error:", orderError);
        return;
    }

    console.log(`Found ${orders.length} orders for client ${client.id}`);

    for (const order of orders) {
        console.log(`\nOrder ${order.id} (${order.service_type})`);
        console.log(`  Delivery Day: ${order.delivery_day || 'No Day'}`);
        console.log(`  Meal Type: ${order.meal_type}`);
        console.log(`  Status: ${order.status}`);

        // 3. Vendor Selections
        const { data: vs, error: vsError } = await supabase
            .from('upcoming_order_vendor_selections')
            .select('*')
            .eq('upcoming_order_id', order.id);

        console.log(`  Vendor Selections: ${vs?.length}`);
        vs?.forEach(v => console.log(`    - VS ID: ${v.id}, Vendor: ${v.vendor_id}`));

        // 4. Items
        const { data: items, error: itemError } = await supabase
            .from('upcoming_order_items')
            .select('*')
            .eq('upcoming_order_id', order.id);

        console.log(`  Items: ${items?.length}`);
        items?.forEach(i => console.log(`    - Item: MealID: ${i.meal_item_id}, MenuID: ${i.menu_item_id}, Qty: ${i.quantity}`));
    }
}

inspectClient();
