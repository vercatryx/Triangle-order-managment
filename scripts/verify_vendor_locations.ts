
import { config } from 'dotenv';
config({ path: '.env.local' });


async function verifyVendorLocations() {
    const { getVendors } = await import('@/lib/actions');
    console.log('Fetching vendors...');

    try {
        const vendors = await getVendors();
        console.log(`Successfully fetched ${vendors.length} vendors.`);

        let foundLocations = false;
        vendors.forEach((v: any) => {
            if (v.locations && v.locations.length > 0) {
                foundLocations = true;
                console.log(`Vendor: ${v.name} has ${v.locations.length} locations associated.`);
                console.log(' - Locations:', v.locations.map((l: any) => l.name).join(', '));
            }
        });

        if (!foundLocations) {
            console.warn('No vendors with locations found. This might be fine if no locations are assigned yet, but double check data.');
        } else {
            console.log('SUCCESS: Vendors have location data.');
        }
    } catch (error) {
        console.error('Error fetching vendors:', error);
    }
}

verifyVendorLocations();
