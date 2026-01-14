
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkSubmission(clientName: string) {
    console.log(`Checking submission for client: "${clientName}"...`);

    // 1. Find Client ID
    const { data: clients, error: clientError } = await supabase
        .from('clients')
        .select('id, full_name, email')
        .ilike('full_name', `%${clientName}%`);

    if (clientError) {
        console.error('Error fetching client:', clientError);
        return;
    }

    if (!clients || clients.length === 0) {
        console.log('No client found with that name.');
        return;
    }

    console.log(`Found ${clients.length} client(s):`);
    clients.forEach(c => console.log(`- ${c.full_name} (${c.id})`));

    const clientId = clients[0].id;

    // 2. Find Submissions
    const { data: submissions, error: subError } = await supabase
        .from('form_submissions')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

    if (subError) {
        console.error('Error fetching submissions:', subError);
        return;
    }

    if (!submissions || submissions.length === 0) {
        console.log('No submissions found for this client.');
        return;
    }

    console.log(`Found ${submissions.length} submission(s):`);
    submissions.forEach(s => {
        console.log(`\nSubmission ID: ${s.id}`);
        console.log(`Status: ${s.status}`);
        console.log(`Created At: ${s.created_at}`);
        console.log(`Token: ${s.token}`);
        console.log(`PDF URL: ${s.pdf_url}`);
        console.log(`Signature URL: ${s.signature_url}`);
    });
}

checkSubmission('aa test food');
