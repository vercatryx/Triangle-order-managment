
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables immediately
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function run() {
    console.log('--- Creating Test Data for Verification ---');

    // Import actions dynamically
    const { updateClient, processUpcomingOrders } = await import('../lib/actions');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Missing Supabase credentials in .env.local');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Common Data
    const { data: vendor } = await supabase.from('vendors').select('*').limit(1).single();
    const { data: status } = await supabase.from('client_statuses').select('id').limit(1).single();
    const { data: navigator } = await supabase.from('navigators').select('id').limit(1).single();
    if (!vendor || !status || !navigator) throw new Error('Missing Ref Data');

    // --- Scenario 1: Box Client ---
    console.log('\n--- Scenario 1: Box Client ---');
    console.log('SKIPPING: Table public.box_types appears to be missing from schema cache.');
    /*
    let { data: boxType } = await supabase.from('box_types').select('*').limit(1).single();
    if (!boxType) {
        console.log('No box types found, creating one...');
        const { data: newBoxType, error: boxTypeError } = await supabase.from('box_types').insert({
            name: 'Standard Box',
            description: 'Default Test Box',
            price: 25,
            quota: 10
        }).select().single();
        if (boxTypeError) console.error('Error creating box type:', boxTypeError);
        boxType = newBoxType;
    }
    if (!boxType) throw new Error('Failed to obtain a Box Type');
    */

    /*
    const boxClientId = uuidv4();
    const boxClientName = `Verification Box Client ${Date.now()}`;

    await supabase.from('clients').insert({
        id: boxClientId,
        full_name: boxClientName,
        email: `box-${Date.now()}@test.com`,
        status_id: status.id,
        service_type: 'Boxes',
        navigator_id: navigator.id,
        approved_meals_per_week: 5,
        created_at: new Date().toISOString()
    });
    console.log(`Created Box Client: ${boxClientName}`);

    // Create Upcoming Order for Box (Manual Insert to ensure structure matches sync logic)
    const { data: boxUpcoming } = await supabase.from('upcoming_orders').insert({
        client_id: boxClientId,
        service_type: 'Boxes',
        status: 'scheduled',
        take_effect_date: new Date().toISOString().split('T')[0], // TODAY
        total_items: 2,
        total_value: 50,
        updated_by: 'Script'
    }).select().single();

    // Create Box Selection
    await supabase.from('upcoming_order_box_selections').insert({
        upcoming_order_id: boxUpcoming.id,
        vendor_id: vendor.id,
        box_type_id: boxType.id,
        quantity: 2,
        unit_value: 25,
        total_value: 50,
        items: { "category_1": { "itemName": "Test Box Item", "quantity": 1, "quotaValue": 1 } },
        item_notes: {}
    });
    console.log('Created Box Upcoming Order setup.');
    */

    const boxClientId = null;
    const boxClientName = "Values Skipped";


    // --- Scenario 2: Food Client with Meal Order ---
    console.log('\n--- Scenario 2: Food Client with Meal Order ---');
    const { data: mealItem } = await supabase.from('breakfast_items').select('*').limit(1).single();
    if (!mealItem) throw new Error('No meal items found');
    console.log(`Using Meal Item: ${mealItem.name}`);

    const mealClientId = uuidv4();
    const mealClientName = `Verification Meal Client ${Date.now()}`;

    await supabase.from('clients').insert({
        id: mealClientId,
        full_name: mealClientName,
        email: `meal-${Date.now()}@test.com`,
        status_id: status.id,
        service_type: 'Food', // Client is Food
        navigator_id: navigator.id,
        approved_meals_per_week: 5,
        created_at: new Date().toISOString()
    });
    console.log(`Created Food Client (Meal Order): ${mealClientName}`);

    // Create Upcoming Order
    const { data: mealUpcoming } = await supabase.from('upcoming_orders').insert({
        client_id: mealClientId,
        service_type: 'Food', // Order is Food service type context, but contains meal items
        status: 'scheduled',
        take_effect_date: new Date().toISOString().split('T')[0],
        total_items: 3,
        total_value: 15,
        updated_by: 'Script'
    }).select().single();

    // Create VS and Items
    const { data: mealVS } = await supabase.from('upcoming_order_vendor_selections').insert({
        upcoming_order_id: mealUpcoming.id,
        vendor_id: vendor.id
    }).select().single();

    const { error: itemError } = await supabase.from('upcoming_order_items').insert({
        upcoming_order_id: mealUpcoming.id, // REQUIRED
        vendor_selection_id: mealVS.id,
        meal_item_id: mealItem.id, // Linking to breakfast_items
        menu_item_id: null, // Corrected: Must be null for Meal Items to pass FK constraint
        quantity: 3,
        unit_value: 5,
        total_value: 15,
        notes: "Meal Item Test"
    });
    if (itemError) console.error('Error inserting meal item:', itemError);
    else console.log('Created Meal Upcoming Order setup.');


    // PROCESS
    console.log('\n--- Processing Orders ---');
    const processResult = await processUpcomingOrders();
    console.log('Processing Result:', processResult);

    // OUTPUT LINKS
    const { data: boxOrder } = await supabase.from('orders').select('*').eq('client_id', boxClientId).single();
    const { data: mealOrder } = await supabase.from('orders').select('*').eq('client_id', mealClientId).single();

    console.log('\n==========================================');
    if (boxOrder) {
        console.log(`BOX ORDER Check: http://localhost:3000/orders/${boxOrder.id}`);
        console.log(`(Client: ${boxClientName})`);
    } else {
        console.error('Failed to create Box Order');
    }

    if (mealOrder) {
        console.log(`MEAL ORDER Check: http://localhost:3000/orders/${mealOrder.id}`);
        console.log(`(Client: ${mealClientName})`);
    } else {
        console.error('Failed to create Meal Order');
    }
    console.log('==========================================');
}

run();
