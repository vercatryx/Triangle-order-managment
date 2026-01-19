import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function assignAllLocations() {
    console.log('Fetching vendors and locations...');

    const { data: vendors, error: vError } = await supabase
        .from('vendors')
        .select('id, name');

    const { data: locations, error: lError } = await supabase
        .from('locations')
        .select('id, name');

    if (vError || lError) {
        console.error('Error fetching data:', vError || lError);
        return;
    }

    if (!vendors || !locations) {
        console.log('No vendors or locations found.');
        return;
    }

    console.log(`Found ${vendors.length} vendors and ${locations.length} global locations.`);

    let totalLinks = 0;

    for (const vendor of vendors) {
        // Prepare all links for this vendor
        const links = locations.map(loc => ({
            vendor_id: vendor.id,
            location_id: loc.id
        }));

        // Bulk insert with ignoreDuplicates (requires the UNIQUE constraint on vendor_locations table)
        const { error } = await supabase
            .from('vendor_locations')
            .upsert(links, { onConflict: 'vendor_id, location_id', ignoreDuplicates: true });

        if (error) {
            console.error(`Error assigning locations to vendor ${vendor.name}:`, error.message);
        } else {
            // Just counting potential links, upsert result doesn't explicitly tell us how many *new* were added easily without return
            // but we know it succeeded.
        }
        totalLinks += links.length;
    }

    console.log('Operation complete.');
    console.log(`Processed ${vendors.length} vendors. Ensured all ${locations.length} locations are linked.`);
}

assignAllLocations();
