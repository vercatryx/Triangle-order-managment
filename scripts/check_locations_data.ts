
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkLocations() {
    console.log('Checking locations table...');
    const { data, error, count } = await supabase
        .from('locations')
        .select('*', { count: 'exact' });

    if (error) {
        console.error('Error fetching locations:', error);
    } else {
        console.log(`Found ${count} locations.`);
        console.log('Locations:', data);
    }
}

checkLocations();
