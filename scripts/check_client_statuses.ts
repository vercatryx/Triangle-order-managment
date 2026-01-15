import { supabase } from '../lib/supabase';

async function checkStatuses() {
    console.log('Checking client_statuses table...');
    const { data, error } = await supabase
        .from('client_statuses')
        .select('*');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${data.length} statuses.`);

    const statusesWithUnits = data.filter(s => s.requires_units_on_change);
    console.log(`Statuses with requires_units_on_change=true: ${statusesWithUnits.length}`);

    statusesWithUnits.forEach(s => {
        console.log(` - ${s.name} (ID: ${s.id})`);
    });

    if (statusesWithUnits.length === 0) {
        console.warn('WARNING: No statuses have requires_units_on_change set to true. The modal will NEVER trigger.');
    }
}

checkStatuses();
