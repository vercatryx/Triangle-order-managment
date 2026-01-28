
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkClientIds() {
    console.log('Checking client IDs...');

    // Fetch ALL IDs without limit (default might be 1000)
    // We can loop or use a high limit
    const { data: allData, count, error } = await supabase
        .from('clients')
        .select('id', { count: 'exact' })
        .limit(2000); // Higher than 932

    if (error) {
        console.error('Error fetching clients:', error);
        return;
    }

    console.log(`Total count from DB: ${count}`);
    console.log(`Fetched count: ${allData.length}`);

    if (allData.length > 0) {
        let maxNum = 0;
        let maxId = '';

        for (const row of allData) {
            if (!row.id) continue;
            const match = row.id.match(/CLIENT-(\d+)/);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) {
                    maxNum = num;
                    maxId = row.id;
                }
            }
        }

        console.log(`Max Numeric ID found: ${maxNum} (${maxId})`);

        // Calculate next
        const nextNum = maxNum + 1;
        const nextId = `CLIENT-${nextNum.toString().padStart(3, '0')}`;
        console.log(`Calculated Next ID: ${nextId}`);

        // Check if nextId exists (sanity check)
        const { data: exists } = await supabase
            .from('clients')
            .select('id')
            .eq('id', nextId)
            .maybeSingle();

        if (exists) {
            console.error(`CRITICAL: Calculated ID ${nextId} ALREADY EXISTS! Logic is flawed.`);
        } else {
            console.log(`ID ${nextId} does not exist. Safe to use.`);
        }
    }
}

checkClientIds();
