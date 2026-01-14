import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectCustomOrders() {
    console.log('Inspecting Custom Upcoming Orders...');
    const { data, error } = await supabase
        .from('upcoming_orders')
        .select('*')
        .eq('service_type', 'Custom');

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No custom upcoming orders found.');
        return;
    }

    console.log(`Found ${data.length} orders.`);
    data.forEach((o, i) => {
        console.log(`\n--- Order ${i + 1} ---`);
        console.log(`ID: ${o.id}`);
        console.log(`Client: ${o.client_id}`);
        console.log(`Delivery Day: ${o.delivery_day}`);
        console.log(`Total Value: ${o.total_value}`);
        console.log(`Notes: "${o.notes}"`);
        // Check for likely cols
        console.log(`Custom Name (col check):`, (o as any).custom_name);
        console.log(`Custom Price (col check):`, (o as any).custom_price);
        console.log(`Full Record:`, JSON.stringify(o, null, 2));
    });
}

inspectCustomOrders();
