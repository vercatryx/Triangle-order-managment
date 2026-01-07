import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load env
try {
    const envPath = join(process.cwd(), '.env.local');
    if (existsSync(envPath)) {
        const envConfig = readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const [key, ...values] = line.split('=');
            if (key && values.length > 0) {
                const value = values.join('=').trim().replace(/^["']|["']$/g, '');
                process.env[key.trim()] = value;
            }
        });
    }
} catch (e) {
    console.error('Error loading .env.local', e);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
});

async function runMigration() {
    const fileArg = process.argv[2];
    if (!fileArg) {
        console.error('Please provide a SQL file path');
        process.exit(1);
    }

    const filePath = join(process.cwd(), fileArg);
    if (!existsSync(filePath)) {
        console.error('File not found:', filePath);
        process.exit(1);
    }

    const sql = readFileSync(filePath, 'utf8');
    console.log(`Running migration: ${fileArg}`);

    // Split by semicolons to run statements individually if needed, 
    // but generic RPC 'exec_sql' would be better if available.
    // However, Supabase JS client doesn't have a direct 'query' method for raw SQL unless exposed via RPC.
    // I'll try to use the postgres library or see if I can use a simpler approach.
    // Actually, I don't have the 'pg' library installed probably.
    // Let's check package.json. If not, I might have to use a workaround or ask user.
    // Workaround: I can't easily run raw SQL without pg or an RPC.
    // I'll check if there's an RPC for this, or if I can use the 'postgres' connection string from .env.local if available?
    // No, I can't see the connection string.

    // WAIT! I don't have 'pg' installed? I should check package.json.
    // If I can't run SQL, I might have to ask the user to run it.
    // BUT! I saw `scripts/` folder. Maybe there's a script that runs SQL?
    // `check_db.ts` uses supabase-js.

    // I will try to use `supabase.rpc('exec_sql', { sql })` - this is a common pattern if set up.
    // If it fails, I'll have to notify the user.

    const { error } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (error) {
        console.error('RPC exec_sql failed:', error);
        console.log('Trying alternative: maybe just log it and ask user to run.');
    } else {
        console.log('Migration successful via RPC!');
    }
}

runMigration();
