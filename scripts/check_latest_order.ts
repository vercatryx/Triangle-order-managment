
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkLatestOrder() {
    console.log("Checking latest order...");

    const { data: orders, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error("Error fetching orders:", error);
        return;
    }

    if (!orders || orders.length === 0) {
        console.log("No orders found.");
        return;
    }

    console.log(`Found ${orders.length} orders.`);

    for (const order of orders) {
        console.log(`Order ${order.id} (${order.service_type}) - Created: ${order.created_at} - Total Value: ${order.total_value} - Total Items (DB): ${order.total_items}`);

        const { count } = await supabase
            .from('order_items')
            .select('*', { count: 'exact', head: true })
            .eq('order_id', order.id);

        console.log(`   -> Real Item Count (Count(*) from order_items): ${count}`);

        const { data: vs } = await supabase
            .from('order_vendor_selections')
            .select('vendor_id')
            .eq('order_id', order.id);

        console.log(`   -> Vendors: ${JSON.stringify(vs)}`);
    }
}

checkLatestOrder();
