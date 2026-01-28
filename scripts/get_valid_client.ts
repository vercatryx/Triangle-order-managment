
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

async function main() {
    const { data, error } = await supabase
        .from('clients')
        .select('id, full_name')
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Client ID:', data?.id);
        console.log('Client Name:', data?.full_name);
    }
}

main();
