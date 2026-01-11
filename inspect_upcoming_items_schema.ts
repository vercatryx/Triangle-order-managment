
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env
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

async function checkSchema() {
    console.log('Checking upcoming_order_items columns...');
    const { data: sample, error } = await supabaseAdmin.from('upcoming_order_items').select('*').limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (sample && sample.length > 0) {
        console.log('Columns:', Object.keys(sample[0]));
    } else {
        // If empty, try to insert a dummy one to see error or just assume strict schema? 
        // Better to check order_items first as it's more likely populated
        console.log('Table empty, checking order_items instead to infer...');
        const { data: orderSample } = await supabaseAdmin.from('order_items').select('*').limit(1);
        if (orderSample && orderSample.length > 0) {
            console.log('order_items Columns:', Object.keys(orderSample[0]));
        }
    }
}

checkSchema();
