
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

async function checkUpcomingSchema() {
    console.log('Checking upcoming_orders columns...');
    const { data: sample, error } = await supabaseAdmin.from('upcoming_orders').select('*').limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (sample && sample.length > 0) {
        console.log('Columns:', Object.keys(sample[0]));
        const hasDeliveryDay = Object.keys(sample[0]).includes('delivery_day');
        console.log('Has delivery_day:', hasDeliveryDay);
    } else {
        console.log('Table empty, cannot verify columns directly from data. Assuming strictly structured.');
    }
}

checkUpcomingSchema();
