
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function clearOrderHistory() {
    console.log('Clearing order_history for all clients...');

    const { error } = await supabase
        .from('clients')
        .update({ order_history: [] })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all valid clients

    if (error) {
        console.error('Error clearing history:', error);
    } else {
        console.log('Successfully cleared order_history for all clients.');
    }
}

clearOrderHistory();
