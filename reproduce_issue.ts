
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Load env
try {
    const envConfig = readFileSync('.env.local', 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            const value = values.join('=').trim();
            process.env[key.trim()] = value.replace(/^["']|["']$/g, '');
        }
    });
} catch (e) {
    console.error('Error loading .env.local', e);
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function run() {
    console.log('Fetching a client...');
    const { data: clients } = await supabase.from('clients').select('*').limit(1);
    if (!clients || clients.length === 0) {
        console.log('No clients found.');
        return;
    }

    const client = clients[0];
    console.log('Original Active Order:', client.active_order);

    const newCaseId = 'TEST-CASE-' + Math.floor(Math.random() * 1000);
    const updatedOrder = {
        ...client.active_order,
        caseId: newCaseId,
        serviceType: client.service_type || 'Food' // Ensure serviceType matches
    };

    console.log('Updating with Case ID:', newCaseId);

    const { error } = await supabase
        .from('clients')
        .update({ active_order: updatedOrder })
        .eq('id', client.id);

    if (error) {
        console.error('Update failed:', error);
        return;
    }

    console.log('Update successful. Fetching back...');
    const { data: updatedClient } = await supabase.from('clients').select('*').eq('id', client.id).single();

    console.log('New Active Order:', updatedClient.active_order);

    if (updatedClient.active_order?.caseId === newCaseId) {
        console.log('SUCCESS: Case ID persisted.');
    } else {
        console.log('FAILURE: Case ID NOT found.');
    }
}

run();
