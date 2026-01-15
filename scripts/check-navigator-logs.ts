
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    console.log('Fetching columns for navigator_logs...');

    const { data, error } = await supabase
        .from('navigator_logs')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error selecting from navigator_logs:', error);
        // Try alternate name
        console.log('Trying navigator_history...');
        const { data: data2, error: error2 } = await supabase
            .from('navigator_history')
            .select('*')
            .limit(1);
        if (error2) {
            console.error('Error selecting from navigator_history:', error2);
        } else if (data2 && data2.length > 0) {
            console.log('Columns found in navigator_history:', Object.keys(data2[0]));
        } else {
            console.log('navigator_history table exists but is empty.');
        }
    } else if (data && data.length > 0) {
        console.log('Columns found in navigator_logs:', Object.keys(data[0]));
    } else {
        console.log('navigator_logs table exists but is empty or columns hidden.');
    }
}

main().catch(console.error);
