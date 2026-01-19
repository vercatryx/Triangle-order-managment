import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function debugFetches() {
    console.log('Testing server-side fetches called by ClientList...');

    // Mimic loadInitialData from ClientList
    try {
        console.time('Fetches');

        console.log('1. getStatuses...');
        const { error: sErr } = await supabase.from('client_statuses').select('*');
        if (sErr) console.error('Error fetching statuses:', sErr.message);
        else console.log('Statuses OK');

        console.log('2. getNavigators...');
        const { error: nErr } = await supabase.from('navigators').select('*');
        if (nErr) console.error('Error fetching navigators:', nErr.message);
        else console.log('Navigators OK');

        console.log('3. getVendors...');
        const { error: vErr } = await supabase.from('vendors').select('*');
        if (vErr) console.error('Error fetching vendors:', vErr.message);
        else console.log('Vendors OK');

        console.log('4. getClients...');
        const { data: cData, error: cErr } = await supabase.from('clients').select('id').limit(10);
        if (cErr) console.error('Error fetching clients:', cErr.message);
        else console.log(`Clients OK (Found ${cData?.length} sample records)`);

        console.timeEnd('Fetches');
        console.log('All initial fetches completed successfully. Backend logic seems fine.');

    } catch (err) {
        console.error('Unexpected error during fetch test:', err);
    }
}

debugFetches();
