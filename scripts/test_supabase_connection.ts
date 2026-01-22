import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

async function testConnection() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    console.log('--- Supabase Connection Test ---');
    console.log('URL:', supabaseUrl ? 'Found' : 'MISSING');
    console.log('Key:', supabaseKey ? 'Found' : 'MISSING');

    if (!supabaseUrl || !supabaseKey) {
        console.error('Error: Supabase environment variables are missing.');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('\nAttempting to query "clients" table...');
    const start = Date.now();

    try {
        const { data, error, status, statusText } = await supabase
            .from('clients')
            .select('id')
            .limit(1);

        const duration = Date.now() - start;
        console.log(`Query took ${duration}ms`);

        if (error) {
            console.error('\n--- QUERY ERROR ---');
            console.error('Status:', status);
            console.error('Status Text:', statusText);
            console.error('Error Message:', error.message);
            console.error('Error Details:', error.details);
            console.error('Error Hint:', error.hint);
            console.error('Error Code:', error.code);

            if (status === 429) {
                console.error('\n[DIAGNOSIS] You are being rate limited (429). This often happens if you reach usage limits.');
            } else if (status === 401 || status === 403) {
                console.error('\n[DIAGNOSIS] Authentication/Permission error. Your API keys might be invalid or RLS is blocking the request.');
            } else if (error.message.includes('fetch')) {
                console.error('\n[DIAGNOSIS] Network or DNS error. This could mean the project is paused or the service is down.');
            }
        } else {
            console.log('Success! Connection is working.');
            console.log('Data sample:', data);
        }
    } catch (err: any) {
        console.error('\n--- UNEXPECTED EXCEPTION ---');
        console.error(err);
    }
}

testConnection();
