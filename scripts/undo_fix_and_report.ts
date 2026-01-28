
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

async function undoFixAndReport() {
    console.log('🚀 Starting Undo Script for Upcoming Orders...');

    // Fetch selections that match the "fix" criteria:
    // 1. Vendor ID matches target
    // 2. Created recently? (Hard to query exactly, but we rely on structure)
    // 3. items is empty (or matches {})
    // Since we can't easily query JSON emptiness in all PostgREST versions via JS lib without raw SQL,
    // we'll fetch ALL selections for this vendor and filter in code.
    // Given the target vendor might have legitimate orders, we must be careful.
    // The "fix" created selections with: quantity: 1, items: {}, total_value: matching order total.

    // Safety check: The user JUST ran this. The created_at should be very recent.
    // Using a timestamp filter (last 1 hour) would be safest if available.
    // 'created_at' is in the schema (saw it in schema inspection log).

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: selections, error } = await supabase
        .from('upcoming_order_box_selections')
        .select(`
            id,
            upcoming_order_id,
            created_at,
            items,
            upcoming_orders (
                client_id,
                clients (
                    full_name
                )
            )
        `)
        .eq('vendor_id', TARGET_VENDOR_ID)
        .eq('quantity', 1)
        .gte('created_at', oneHourAgo); // Only touch records created in the last hour

    if (error) {
        console.error('Error fetching selections:', error);
        return;
    }

    // Filter for empty items (our signature placeholder)
    // Note: Items might be null or {}
    const fixRecords = selections.filter(s => {
        // Check if items is empty object or null
        const items = s.items;
        const isEmpty = !items || (typeof items === 'object' && Object.keys(items).length === 0);
        return isEmpty;
    });

    if (fixRecords.length === 0) {
        console.log('✅ No records found matching the automated fix criteria (Vendor Target + Empty Items + Created last hour).');
        return;
    }

    console.log(`⚠️  Found ${fixRecords.length} records to UNDO.`);

    // Extract Client Names
    const affectedClients = new Map<string, string>(); // ID -> Name
    fixRecords.forEach(s => {
        const order = s.upcoming_orders;
        // @ts-ignore
        const client = order?.clients;
        // @ts-ignore
        const clientId = order?.client_id;
        const clientName = client?.full_name || 'Unknown Client';

        if (clientId) {
            affectedClients.set(clientId, clientName);
        }
    });

    console.log('\n📋 Affected Clients:');
    affectedClients.forEach((name, id) => {
        console.log(`- ${name} (${id})`);
    });

    // Perform Undo (Delete)
    console.log(`\nDeleting ${fixRecords.length} updated selection records...`);
    const idsToDelete = fixRecords.map(s => s.id);

    const { error: deleteError } = await supabase
        .from('upcoming_order_box_selections')
        .delete()
        .in('id', idsToDelete);

    if (deleteError) {
        console.error('❌ Error deleting records:', deleteError);
    } else {
        console.log('✅ Undo successful. Records deleted.');
    }
}

undoFixAndReport();
