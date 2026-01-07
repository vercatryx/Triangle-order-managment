
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkColumns() {
    const { data, error } = await supabase
        .rpc('get_upcoming_orders_columns'); // Try RPC first if available, otherwise just select * limit 1

    if (error) {
        // Fallback: Select one row and print keys
        const { data: rows, error: selectError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .limit(1);

        if (selectError) {
            console.error('Error selecting:', selectError);
            return;
        }

        if (rows && rows.length > 0) {
            console.log('Columns in upcoming_orders based on row 1:', Object.keys(rows[0]));
        } else {
            console.log('No rows in upcoming_orders, cannot infer columns easily via JS client without admin access or RPC.');
            // Try to insert a dummy row and see if it fails? No, that's risky.
            // Let's assume if it's not in the object keys returned it might not be there, 
            // OR use the explicit information_schema query if we can via SQL wrapper.
            // But we can't run raw SQL easily via JS client unless we used postgres.js or similar direct connection.
        }
    }
}

checkColumns();
