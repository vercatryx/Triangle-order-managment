
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log('Checking schema for table: upcoming_order_box_selections');

    // Attempt to select the column. If it doesn't exist, this should fail.
    const { data, error } = await supabase
        .from('upcoming_order_box_selections')
        .select('box_type_id')
        .limit(1);

    if (error) {
        console.error('Error selecting box_type_id:', error.message);
        console.error('Error details:', error);
    } else {
        console.log('Successfully selected box_type_id. Column exists.');
    }

    // Also check standard columns to make sure table exists
    const { error: tableError } = await supabase
        .from('upcoming_order_box_selections')
        .select('id')
        .limit(1);

    if (tableError) {
        console.error('Table verification failed:', tableError.message);
    } else {
        console.log('Table upcoming_order_box_selections exists.');
    }
}

checkSchema().catch(console.error);
