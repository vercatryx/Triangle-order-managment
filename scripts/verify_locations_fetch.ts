

import { config } from 'dotenv';
config({ path: '.env.local' });
import { getGlobalLocations } from '@/lib/actions';


async function verifyLocations() {
    console.log('Fetching global locations...');
    try {
        const locations = await getGlobalLocations();
        console.log(`Successfully fetched ${locations.length} locations.`);
        if (locations.length > 0) {
            console.log('Sample locations:', locations.slice(0, 3).map((l: any) => l.name).join(', '));
        } else {
            console.warn('No locations found. (This might be valid if DB is empty, but unexpected for this task)');
        }
    } catch (error) {
        console.error('Error fetching locations:', error);
    }
}

verifyLocations();
