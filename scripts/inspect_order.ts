
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables immediately
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function run() {
    const orderId = '5c9dc293-ee28-44cd-a8c2-bcfa8fe6f34c'; // The NEW failing order
    console.log(`--- Inspecting Order: ${orderId} ---`);

    // Import actions dynamically
    const { getOrderById } = await import('../lib/actions');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
        const orderDetails = await getOrderById(orderId);
        console.log('Order Details Output:');
        console.log(JSON.stringify(orderDetails, null, 2));

        console.log('\n--- Direct DB Check ---');
        // Check order items via Vendor Selection ID if available
        if (orderDetails?.vendorSelections && orderDetails.vendorSelections.length > 0) {
            const vsId = orderDetails.vendorSelections[0].vendorId; // wait, orderDetails struct has vendorSelections objects which have `vendorId` and `items`. 
            // Actually getOrderById returns: { serviceType, vendorSelections: [ { vendorId, vendorName, items: [] } ] }
            // It does NOT return the vsID in the output object usually? 
            // Let's query the VS ID directly from DB for this order.

            const { data: vsData } = await supabase.from('order_vendor_selections').select('id').eq('order_id', orderId);
            console.log('DB found VS IDs:', vsData);

            if (vsData && vsData.length > 0) {
                const { data: orderItems, error: oiError } = await supabase
                    .from('order_items')
                    .select('*')
                    .eq('vendor_selection_id', vsData[0].id);

                console.log('Items linked to VS ID', vsData[0].id, ':', orderItems?.length);
                if (orderItems?.length) console.log('Sample Item:', orderItems[0]);
            }
        }

        // Check Items linked to Order ID directly (if schema supports it, strictly for debug)
        const { data: allOrderItems } = await supabase.from('order_items').select('*').eq('order_id', orderId);
        console.log('Items linked to OrderID directly:', allOrderItems?.length);

        // Check Upcoming Items source
        console.log('\n--- Upcoming Data Check ---');
        const { data: client } = await supabase.from('clients').select('id').eq('email', 'meal-1768755349615@test.com').single();
        if (client) {
            const { data: upcomingOrders } = await supabase.from('upcoming_orders').select('*').eq('client_id', client.id);
            console.log('Upcoming Orders found:', upcomingOrders?.length);
            if (upcomingOrders && upcomingOrders.length > 0) {
                const uo = upcomingOrders[0];
                console.log('Upcoming Order Status:', uo.status);

                const { data: uoVS } = await supabase.from('upcoming_order_vendor_selections').select('*').eq('upcoming_order_id', uo.id);
                console.log('Upcoming VS count:', uoVS?.length);

                if (uoVS && uoVS.length > 0) {
                    const { data: uoItems } = await supabase.from('upcoming_order_items').select('*').eq('vendor_selection_id', uoVS[0].id);
                    console.log('Upcoming Items count:', uoItems?.length);
                    if (uoItems?.length) console.log('Upcoming Sample:', uoItems[0]);
                }
            }
        }

    } catch (e) {
        console.error('Error fetching order:', e);
    }
}

run();
