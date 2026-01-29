import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local manually
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^['"]|['"]$/g, '');
            process.env[key] = value;
        }
    });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!; // Or SERVICE_ROLE if available
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log('Verifying client count...');

    // 1. Get exact count from DB
    const { count, error: countError } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true });

    if (countError) {
        console.error('Error fetching count:', countError);
        return;
    }

    console.log(`Total clients in DB: ${count}`);

    // 2. Simulate fetching all clients using our logic (re-implemented here since we can't easily import from lib without transpile)
    // We replicate the exact logic to verify it works as a standalone concept

    let allClients: any[] = [];
    let page = 0;
    const pageSize = 1000;

    console.log('Fetching clients via pagination loop...');
    const startTime = Date.now();

    while (true) {
        process.stdout.write(`Fetching page ${page}... `);
        const { data, error } = await supabase
            .from('clients')
            .select('id')
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
            console.error('\nError fetching clients:', error);
            break;
        }

        if (!data || data.length === 0) {
            console.log('No data returned.');
            break;
        }

        console.log(`Got ${data.length} records.`);
        allClients.push(...data);

        if (data.length < pageSize) break;
        page++;
    }

    const duration = Date.now() - startTime;
    console.log(`\nFetched ${allClients.length} clients in ${duration}ms.`);

    if (allClients.length === count) {
        console.log('SUCCESS: Fetched count matches DB count.');
    } else {
        console.error(`FAILURE: Fetched ${allClients.length}, expected ${count}.`);
    }
}

main();
