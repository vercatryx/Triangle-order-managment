import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

try {
    const envConfig = readFileSync('.env.local', 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            const value = values.join('=').trim();
            // Remove quotes if present
            process.env[key.trim()] = value.replace(/^["']|["']$/g, '');
        }
    });
} catch (e) {
    console.error('Error loading .env.local', e);
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!
);

async function inspect() {
    console.log('Inspecting upcoming_orders table...');

    // Check columns by inserting a dummy record that will fail but show column names in error or success
    // Or better, just select * limit 1 and print keys
    const { data, error } = await supabase
        .from('upcoming_orders')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching upcoming_orders:', error);
    } else if (data && data.length > 0) {
        console.log('Column names:', Object.keys(data[0]));
    } else {
        console.log('Table exists but is empty. Trying to list columns via RPC if available or just check known columns.');
        // We can't easily check constraints via supabase-js client directly without SQL editor access or inspection RPC.
        // But we can infer from existing migrations or just try to insert duplicate and see error.
    }
}

inspect();
