
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function recoverNotes(orderId: string) {
    console.log(`Attempting to recover notes for order: ${orderId}`);

    // 1. Find the upcoming order that generated this order
    const { data: upcomingOrder, error: uoError } = await supabase
        .from('upcoming_orders')
        .select('id')
        .eq('processed_order_id', orderId)
        .single();

    if (uoError || !upcomingOrder) {
        console.error('Could not find corresponding upcoming order:', uoError);
        return;
    }

    console.log(`Found source upcoming order: ${upcomingOrder.id}`);

    // 2. Fetch items from the upcoming order (source of truth for notes)
    // We need to match them to the current order items.
    // The matching is tricky because IDs are different.
    // We can match by vendor_selection -> vendor_id and then by menu_item_id or similar.

    // Get current order items
    const { data: currentItems, error: ciError } = await supabase
        .from('order_items')
        .select('id, menu_item_id, vendor_selection_id, quantity')
        .eq('order_id', orderId);

    if (ciError) {
        console.error('Error fetching current items:', ciError);
        return;
    }

    // Get current vendor selections to map vendor IDs
    const { data: currentVendorSelections } = await supabase
        .from('order_vendor_selections')
        .select('id, vendor_id')
        .eq('order_id', orderId);

    // Get source upcoming vendor selections
    const { data: sourceVendorSelections } = await supabase
        .from('upcoming_order_vendor_selections')
        .select('id, vendor_id')
        .eq('upcoming_order_id', upcomingOrder.id);

    if (!currentItems || !currentVendorSelections || !sourceVendorSelections) {
        console.log("Missing necessary data for mapping.");
        return;
    }

    console.log(`Mapping ${currentItems.length} items...`);

    let updatedCount = 0;

    for (const currentItem of currentItems) {
        // Find the vendor ID for this item
        const currentVS = currentVendorSelections.find(vs => vs.id === currentItem.vendor_selection_id);
        if (!currentVS) continue;

        // Find corresponding source vendor selection
        const sourceVS = sourceVendorSelections.find(vs => vs.vendor_id === currentVS.vendor_id);
        if (!sourceVS) continue;

        // Find the source item in upcoming_order_items
        // Match by vendor_selection_id and menu_item_id (and quantity to be safe, though loose matching is better here)
        const { data: sourceItem } = await supabase
            .from('upcoming_order_items')
            .select('notes')
            .eq('vendor_selection_id', sourceVS.id)
            .eq('menu_item_id', currentItem.menu_item_id)
            .single(); // Assuming unique menu item per vendor selection which is standard

        if (sourceItem && sourceItem.notes) {
            console.log(`Found note for item ${currentItem.id}: "${sourceItem.notes}"`);

            // Update the current item
            const { error: updateError } = await supabase
                .from('order_items')
                .update({ notes: sourceItem.notes })
                .eq('id', currentItem.id);

            if (!updateError) {
                updatedCount++;
            } else {
                console.error(`Failed to update item ${currentItem.id}:`, updateError);
            }
        }
    }

    console.log(`Recovery complete. Updated items: ${updatedCount}`);
}

const orderIdToCheck = 'cc0d537c-d242-483e-a720-b7fddcbf3724';
recoverNotes(orderIdToCheck);
