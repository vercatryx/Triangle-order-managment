
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyManualInsert() {
    console.log('Testing explicit insert with ID CLIENT-99999...');

    // Check if it exists first
    const { data: exists } = await supabase.from('clients').select('id').eq('id', 'CLIENT-99999').maybeSingle();
    if (exists) {
        console.log('CLIENT-99999 already exists, deleting...');
        await supabase.from('clients').delete().eq('id', 'CLIENT-99999');
    }

    const payload = {
        id: 'CLIENT-99999',
        full_name: 'Test Explicit Insert',
        parent_client_id: 'CLIENT-023', // Ensure this parent exists
        service_type: 'Food',
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from('clients')
        .insert([payload])
        .select()
        .single();

    if (error) {
        console.error('Insert Error:', error);
    } else {
        console.log('Insert Success:', data);
        console.log('ID in DB:', data.id);

        if (data.id !== 'CLIENT-99999') {
            console.error('MISMATCH! Database overrode the ID.');
        } else {
            console.log('MATCH! Database accepted the ID.');
        }

        // Cleanup
        await supabase.from('clients').delete().eq('id', 'CLIENT-99999');
    }
}

verifyManualInsert();
