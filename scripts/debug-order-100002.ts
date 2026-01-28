import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env manually to ensure we have keys
const envPath = path.resolve(process.cwd(), '.env.local');
const envFile = fs.readFileSync(envPath, 'utf8');
const envConfig: Record<string, string> = {};
envFile.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values) {
        envConfig[key.trim()] = values.join('=').trim().replace(/(^"|"$)/g, '');
    }
});

const supabase = createClient(
    envConfig['NEXT_PUBLIC_SUPABASE_URL'],
    envConfig['SUPABASE_SERVICE_ROLE_KEY']
);

async function checkOrder() {
    console.log('Checking order 100002...');
    const { data: order, error } = await supabase
        .from('orders')
        .select('*')
        .eq('order_number', 100002)
        .single();

    if (error) {
        console.error('Error fetching order:', error);
    } else {
        console.log('Order found:', {
            id: order.id,
            status: order.status,
            client_id: order.client_id,
            delivery_proof_url: order.delivery_proof_url,
            scheduled_delivery_date: order.scheduled_delivery_date
        });
    }

    // Also check upcoming orders for this client to see if fallback is happening
    if (order) {
        console.log('Checking upcoming orders for client:', order.client_id);
        const { data: upcoming, error: upError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('client_id', order.client_id)
            .eq('status', 'scheduled');

        if (upError) console.error('Error fetching upcoming:', upError);
        else console.log('Upcoming orders found:', upcoming.length);
    }
}

checkOrder();
