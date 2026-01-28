
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { saveClientFoodOrder } from '../lib/actions'; // Adjust import if needed, might need relative path handling for tsx
// Note: importing directly from lib/actions might be tricky with tsx if it relies on next/headers (cookies). 
// Accessing 'cookies' from 'next/headers' falls back to empty in standalone scripts usually, but might error.
// If it errors, we might need to mock getSession or modify actions.ts to be script-friendly.

// Ideally, we'd use the Supabase client directly to check results, but we want to test the *function* execution flow.
// Let's try to mock the specific parts or just use the Supabase client to inspect the DB after a manual run.
// Actually, running the action function in a standalone script often fails due to 'next/headers'.

// ALTERNATIVE: verifying via direct DB manipulation if logic was pure, but it's not.
// Let's try to run it. If it fails on 'next/headers', I'll mock it.

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing env vars');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log('--- Starting Debug History Save ---');

    // 1. Get a test client
    const { data: clients, error: clientError } = await supabase.from('clients').select('id, full_name').limit(1);
    if (clientError) console.error('Client Fetch Error:', clientError);
    if (!clients || clients.length === 0) {
        console.error('No clients found. (Check RLS policies or DB connection)');
        return;
    }
    const client = clients[0];
    console.log(`Testing with Client: ${client.full_name} (${client.id})`);

    // 2. Call saveClientFoodOrder
    // We expect this might fail due to 'getSession' using cookies.
    // If so, we can't easily test the action function in isolation without mocking.
    // However, I can manually duplicate the logic here to verify specific parts (like appendOrderHistory if I export it separately and genericize it).

    // Actually, let's just inspect the Client's order history row directly to confirm it's empty first.
    let { data: before } = await supabase.from('clients').select('order_history').eq('id', client.id).single();
    console.log('History count before:', before?.order_history?.length || 0);

    // I cannot easily invoke the server action here. 
    // Instead, I will ask the user to save in the UI, or I can try to simulate the raw DB update that appendOrderHistory does.
    // But testing my *code* is the goal.

    // DIFFERENT APPROACH:
    // I will modify `lib/actions.ts` to allow bypassing session checks if a flag is passed, OR just rely on the user testing the UI.
    // Given the user is engaged, UI testing is best.

    // But I can write a small script that just does what appendOrderHistory does (the raw logic) to see if THAT fails.

    console.log('--- Simulation of appendOrderHistory ---');
    const orderDetails = {
        type: 'order', // 'upcoming' in actual code usually
        orderId: 'test-order-id',
        serviceType: 'Food',
        timestamp: new Date().toISOString(),
        testData: 'This is a test entry from script'
    };

    // LOGIC from appendOrderHistory (simplified for test)
    let currentHistory = before?.order_history || [];
    if (typeof currentHistory === 'string') currentHistory = JSON.parse(currentHistory);
    // @ts-ignore
    const updatedHistory = [orderDetails, ...currentHistory];

    console.log('Attempting Supabase Update...');
    const { error } = await supabase.from('clients').update({ order_history: updatedHistory }).eq('id', client.id);

    if (error) {
        console.error('Simulated Update Failed:', error);
    } else {
        console.log('Simulated Update Success! DB accepts the JSON structure.');
    }
}

run();
