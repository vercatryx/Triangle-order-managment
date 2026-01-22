import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

async function testConnection() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log('--- Supabase Service Role Connection Test ---');
    console.log('URL:', supabaseUrl ? 'Found' : 'MISSING');
    console.log('Service Role Key:', serviceRoleKey ? 'Found' : 'MISSING');

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable is missing.');
        return;
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    console.log('\nAttempting to query "clients" table with SERVICE ROLE (bypassing RLS)...');
    const start = Date.now();

    try {
        const { data, error, status } = await supabase
            .from('clients')
            .select('id')
            .limit(1);

        const duration = Date.now() - start;
        console.log(`Query took ${duration}ms`);

        if (error) {
            console.error('\n--- QUERY ERROR ---');
            console.error('Status:', status);
            console.error('Error Message:', error.message);
        } else {
            console.log('Success! Connection with Service Role is working.');
            console.log('Data sample:', data);
        }
    } catch (err: any) {
        console.error('\n--- UNEXPECTED EXCEPTION ---');
        console.error(err);
    }
}

testConnection();
