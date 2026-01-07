
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load env (try multiple paths)
const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
} else {
    dotenv.config();
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function inspectClient() {
    const clientId = 'CLIENT-005'; // ID from user logs
    console.log('Inspecting client:', clientId);

    // 1. Check clients.active_order
    const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('id, full_name, active_order')
        .eq('id', clientId)
        .single();

    if (clientError) {
        console.error('Error fetching client:', clientError);
    } else {
        console.log('--- Client Data ---');
        console.log('ID:', client.id);
        console.log('Name:', client.full_name);
        console.log('Active Order JSON Keys:', client.active_order ? Object.keys(client.active_order) : 'null');
        console.log('Breakfast Vendors:', JSON.stringify(client.active_order?.breakfastCategoryVendors, null, 2));
    }

    // 2. Check upcoming_orders
    const { data: orders, error: ordersError } = await supabase
        .from('upcoming_orders')
        .select('*')
        .eq('client_id', clientId);

    if (ordersError) {
        console.error('Error fetching upcoming orders:', ordersError);
    } else {
        console.log('\n--- Upcoming Orders ---');
        console.log('Count:', orders.length);
        orders.forEach((o, i) => {
            console.log(`Order #${i + 1} ID:`, o.id);
            console.log(`Order #${i + 1} Columns:`, Object.keys(o));
            // Check if there's any hidden JSON field that might hold config
            // console.log(`Order #${i+1} Data:`, o); 
        });
    }
}

inspectClient();
