
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// 1. Load Environment Variables
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase URL or Service Role Key in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const TARGET_VENDOR_ID = '3152cbbc-662b-4cb4-bd70-6d4c505aee7c';

async function cleanupInvalidVendors() {
    console.log('🚀 Starting Vendor Cleanup Script...');
    console.log(`Target Fallback Vendor ID: ${TARGET_VENDOR_ID}`);

    // 2. Verify Target Vendor Exists
    const { data: targetVendor, error: targetError } = await supabase
        .from('vendors')
        .select('id, name')
        .eq('id', TARGET_VENDOR_ID)
        .single();

    if (targetError || !targetVendor) {
        console.error(`❌ Target vendor ${TARGET_VENDOR_ID} NOT FOUND! Aborting.`);
        return;
    }
    console.log(`✅ Verified Target Vendor: ${targetVendor.name}`);

    // 3. Get All Valid Vendor IDs
    const { data: allVendors, error: vendorsError } = await supabase
        .from('vendors')
        .select('id');

    if (vendorsError || !allVendors) {
        console.error('❌ Failed to fetch vendors:', vendorsError);
        return;
    }

    const validVendorIds = new Set(allVendors.map(v => v.id));
    console.log(`ℹ️  Found ${validVendorIds.size} valid vendors.`);

    // 4. Cleanup Tables
    await cleanupTable('order_vendor_selections', 'vendor_id', validVendorIds);
    await cleanupTable('order_box_selections', 'vendor_id', validVendorIds);
    await cleanupTable('upcoming_order_vendor_selections', 'vendor_id', validVendorIds);
    await cleanupTable('upcoming_order_box_selections', 'vendor_id', validVendorIds);


    // 5. Cleanup Equipment Orders (JSON Notes)
    await cleanupEquipmentOrders(validVendorIds);

    // 6. Cleanup ORPHANED Orders (Missing Selection Data)
    await cleanupOrphanedOrders();

    console.log('\n🎉 Cleanup Complete.');
}

async function cleanupOrphanedOrders() {
    console.log('\nChecking for Orphaned Orders (Missing Selection Data)...');

    // 1. Boxes Orders without Selection
    const { data: boxOrders } = await supabase
        .from('orders')
        .select('id, total_value')
        .eq('service_type', 'Boxes');

    if (boxOrders) {
        // Fetch existing selections
        const { data: selections } = await supabase
            .from('order_box_selections')
            .select('order_id');

        const existingOrderIds = new Set(selections?.map(s => s.order_id));
        const orphans = boxOrders.filter(o => !existingOrderIds.has(o.id));

        if (orphans.length > 0) {
            console.log(`⚠️  Found ${orphans.length} orphaned Box orders. Creating default selections...`);

            // Fetch a valid Box Type for this vendor to be safe? Or leave null.
            // Let's try to find ONE box type for this vendor to make it cleaner, if possible.
            const { data: boxTypes } = await supabase
                .from('box_types')
                .select('id')
                .eq('vendor_id', TARGET_VENDOR_ID)
                .limit(1)
                .maybeSingle();

            const fallbackBoxTypeId = boxTypes?.id || null;

            const newSelections = orphans.map(o => ({
                order_id: o.id,
                vendor_id: TARGET_VENDOR_ID,
                box_type_id: fallbackBoxTypeId,
                quantity: 1,
                total_value: o.total_value,
                items: {}
            }));

            const { error } = await supabase
                .from('order_box_selections')
                .insert(newSelections);

            if (error) console.error('Error repairing orphaned Box orders:', error);
            else console.log(`✅ Repaired ${orphans.length} Box orders.`);
        } else {
            console.log('✅ No orphaned Box orders found.');
        }
    }

    // 2. Upcoming Boxes Orders without Selection
    const { data: upcomingBoxOrders } = await supabase
        .from('upcoming_orders')
        .select('id, total_value')
        .eq('service_type', 'Boxes');

    if (upcomingBoxOrders) {
        const { data: selections } = await supabase
            .from('upcoming_order_box_selections')
            .select('upcoming_order_id');

        const existingIds = new Set(selections?.map(s => s.upcoming_order_id));
        const orphans = upcomingBoxOrders.filter(o => !existingIds.has(o.id));

        if (orphans.length > 0) {
            console.log(`⚠️  Found ${orphans.length} orphaned Upcoming Box orders. Creating default selections...`);

            const { data: boxTypes } = await supabase
                .from('box_types')
                .select('id')
                .eq('vendor_id', TARGET_VENDOR_ID)
                .limit(1)
                .maybeSingle();

            const fallbackBoxTypeId = boxTypes?.id || null;

            const newSelections = orphans.map(o => ({
                upcoming_order_id: o.id,
                vendor_id: TARGET_VENDOR_ID,
                // box_type_id: fallbackBoxTypeId, // Column does not exist on upcoming table
                quantity: 1,
                total_value: o.total_value,
                items: {}
            }));

            const { error } = await supabase
                .from('upcoming_order_box_selections')
                .insert(newSelections);

            if (error) console.error('Error repairing orphaned Upcoming Box orders:', error);
            else console.log(`✅ Repaired ${orphans.length} Upcoming Box orders.`);
        } else {
            console.log('✅ No orphaned Upcoming Box orders found.');
        }
    }
}


async function cleanupTable(tableName: string, userIdColumn: string, validIds: Set<string>) {
    console.log(`\nChecking table: ${tableName}...`);

    // Fetch all unique vendor_ids from this table
    // We fetch all distinct vendor_ids first to minimize read ops if possible, 
    // but typically we just fetch the column.

    // Page through results if huge, but for this task fetching distinct vendor_ids is efficient enough start
    // However, we want to FIND records where vendor_id is NOT in validIds.
    // Supabase .not.in() would be great but the list of valid IDs might be large?
    // Actually, listing valid IDs in a .not.in() query is the most direct way if the list isn't huge (e.g. < 1000).
    // Assuming < 100 vendors.

    const validIdsArray = Array.from(validIds);

    // Find bad IDs
    const { data: badRecords, error } = await supabase
        .from(tableName)
        .select(`id, ${userIdColumn}`)
        .not(userIdColumn, 'in', `(${validIdsArray.map(id => `"${id}"`).join(',')})`)
        .not(userIdColumn, 'is', null); // Ignore nulls if allowed? Usually assume vendor_id shouldn't be null if it exists, or handled elsewhere.

    if (error) {
        console.error(`Error querying ${tableName}:`, error);
        return;
    }

    if (!badRecords || badRecords.length === 0) {
        console.log(`✅ No invalid references found in ${tableName}.`);
        return;
    }

    console.log(`⚠️  Found ${badRecords.length} records with invalid vendor IDs in ${tableName}. Reassigning...`);

    // Perform updates
    // Optimization: Bulk update? Since they all go to the SAME target ID, we can do where 'id' in [list of bad record ids]
    const idsToUpdate = badRecords.map(r => r.id);

    const { error: updateError } = await supabase
        .from(tableName)
        .update({ [userIdColumn]: TARGET_VENDOR_ID })
        .in('id', idsToUpdate);

    if (updateError) {
        console.error(`❌ Failed to update ${tableName}:`, updateError);
    } else {
        console.log(`✅ Successfully updated ${idsToUpdate.length} records in ${tableName}.`);
    }
}

async function cleanupEquipmentOrders(validIds: Set<string>) {
    console.log('\nChecking Equipment Orders (JSON Notes)...');

    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, notes')
        .eq('service_type', 'Equipment');

    if (error) {
        console.error('Error fetching equipment orders:', error);
        return;
    }

    if (!orders || orders.length === 0) return;

    let updatedCount = 0;
    const updates = [];

    for (const order of orders) {
        if (!order.notes) continue;
        try {
            const notes = JSON.parse(order.notes);
            if (notes && notes.vendorId && !validIds.has(notes.vendorId)) {
                console.log(`⚠️  Order ${order.id}: Invalid Equipment Vendor ${notes.vendorId}`);

                notes.vendorId = TARGET_VENDOR_ID;
                updates.push({
                    id: order.id,
                    notes: JSON.stringify(notes)
                });
                updatedCount++;
            }
        } catch (e) {
            // ignore JSON parse errors
        }
    }

    if (updatedCount === 0) {
        console.log('✅ No invalid equipment vendor references found.');
        return;
    }

    console.log(`Updating ${updatedCount} equipment orders...`);

    // Process updates individually since JSON content varies
    for (const update of updates) {
        const { error } = await supabase
            .from('orders')
            .update({ notes: update.notes })
            .eq('id', update.id);

        if (error) console.error(`Failed to update order ${update.id}:`, error);
    }

    console.log(`✅ Updated ${updatedCount} equipment orders.`);
}

cleanupInvalidVendors();
