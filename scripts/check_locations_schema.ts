import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkSchema() {
    console.log('Checking database schema...');

    // Check if 'locations' table exists
    const { error: locError } = await supabase.from('locations').select('count', { count: 'exact', head: true });

    if (locError) {
        console.error('❌ Error accessing "locations" table. It likely does not exist.');
        console.error('Details:', locError.message);
        console.log('\n⚠️  CRITICAL: You must run the migration script "sql/create_global_locations.sql" in your Supabase SQL Editor.');
    } else {
        console.log('✅ "locations" table exists.');
    }

    // Check 'vendor_locations' columns
    const { data: vlData, error: vlError } = await supabase.from('vendor_locations').select('*').limit(1);
    if (vlError) {
        // It might be empty, but if table doesn't exist we get error
        if (vlError.code === '42P01') { // undefined_table
            console.error('❌ "vendor_locations" table seems missing or inaccessible.');
        } else {
            console.log('⚠️ "vendor_locations" table access error:', vlError.message);
        }
    } else {
        console.log('✅ "vendor_locations" table exists.');
        // usage check
        if (vlData && vlData.length > 0) {
            const sample = vlData[0];
            if ('location_id' in sample) {
                console.log('✅ "vendor_locations" has "location_id" column.');
            } else {
                console.error('❌ "vendor_locations" misses "location_id". Migration might be incomplete.');
            }
        } else {
            console.log('ℹ️ "vendor_locations" is empty (this is okay if no links created yet).');
        }
    }
}

checkSchema();
