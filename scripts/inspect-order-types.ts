
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env manually
const envPath = path.resolve(process.cwd(), '.env.local');
const envFile = fs.readFileSync(envPath, 'utf8');
const envConfig: Record<string, string> = {};
envFile.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values) {
        envConfig[key.trim()] = values.join('=').trim().replace(/(^"|"$)/g, '');
    }
});

const supabaseAdmin = createClient(
    envConfig['NEXT_PUBLIC_SUPABASE_URL'],
    envConfig['SUPABASE_SERVICE_ROLE_KEY']
);

async function inspectSchema() {
    console.log('--- Inspecting orders table ---');
    const { data: order, error: orderErr } = await supabaseAdmin
        .from('orders')
        .select('*')
        .limit(1)
        .maybeSingle();

    if (orderErr) {
        console.error('Orders Error:', orderErr);
    } else if (order) {
        console.log('Orders columns:', Object.keys(order));
        console.log('Sample Order:', order);
    } else {
        console.log('No orders found.');
    }

    console.log('\n--- Inspecting upcoming_orders table ---');
    const { data: upcoming, error: upcomingErr } = await supabaseAdmin
        .from('upcoming_orders')
        .select('*')
        .limit(1)
        .maybeSingle();

    if (upcomingErr) {
        console.error('Upcoming Error:', upcomingErr);
    } else if (upcoming) {
        console.log('Upcoming columns:', Object.keys(upcoming));
        console.log('Sample Upcoming Order:', upcoming);
    } else {
        console.log('No upcoming_orders found.');
    }
}

inspectSchema();
