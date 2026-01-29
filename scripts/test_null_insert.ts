
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testNullInsert() {
    console.log('Testing insert with null value for missing column...');

    // We need a valid upcoming_order_id to insert a row
    // Let's create a temporary upcoming order first (or find one)
    const { data: order, error: orderError } = await supabase
        .from('upcoming_orders')
        .insert({
            client_id: 'db3b5846-9d26-4074-984e-2895c1920800', // Just a placeholder, hopefully valid UUID format
            service_type: 'Boxes',
            status: 'scheduled',
            updated_by: 'Test Script'
        })
        .select()
        .single();

    // If that fails due to FK, we might need a real client ID. 
    // But let's see if we can just rely on the error message structure from the box insert.
    // Actually, we don't need a valid upcoming_order_id to test the SCHEMA error.
    // The schema check happens before the FK check usually?
    // Let's try with a dummy UUID.

    const dummyId = '00000000-0000-0000-0000-000000000000';

    console.log('Attempting insert with { box_type_id: null }');
    const { error: nullError } = await supabase
        .from('upcoming_order_box_selections')
        .insert({
            upcoming_order_id: dummyId,
            box_type_id: null,
            quantity: 1
        });

    if (nullError) {
        console.log('Insert with null failed:', nullError.message);
    } else {
        console.log('Insert with null SUCCEEDED.');
    }

    console.log('Attempting insert with { box_type_id: undefined }');
    const { error: undefinedError } = await supabase
        .from('upcoming_order_box_selections')
        .insert({
            upcoming_order_id: dummyId,
            box_type_id: undefined,
            quantity: 1
        });

    if (undefinedError) {
        console.log('Insert with undefined failed:', undefinedError.message);
    } else {
        console.log('Insert with undefined SUCCEEDED.');
    }

    console.log('Attempting insert with { box_type_id: "some-uuid" }');
    const { error: valueError } = await supabase
        .from('upcoming_order_box_selections')
        .insert({
            upcoming_order_id: dummyId,
            box_type_id: '00000000-0000-0000-0000-000000000000',
            quantity: 1
        });

    if (valueError) {
        console.log('Insert with value failed:', valueError.message);
    } else {
        console.log('Insert with value SUCCEEDED.');
    }
}

testNullInsert().catch(console.error);
