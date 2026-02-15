/**
 * Debug script for Retell look_up_client — why is no client found?
 *
 * Run from project root:
 *   npx tsx scripts/debug-retell-lookup-client.ts [phone]
 *
 * Example:
 *   npx tsx scripts/debug-retell-lookup-client.ts 8457826353
 *   npx tsx scripts/debug-retell-lookup-client.ts "845-782-6353"
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

function normalizePhone(input: string | null | undefined): string {
    if (input == null || typeof input !== 'string') return '';
    return input.replace(/\D/g, '');
}

async function main() {
    const rawArg = process.argv[2] ?? '8457826353';
    const phone = normalizePhone(rawArg);

    console.log('--- Retell look_up_client Debug ---\n');
    console.log('Input:', rawArg);
    console.log('Normalized (digits only):', phone);
    console.log('');

    // 1. Same query as the API
    console.log('1. API query (exact match on normalized digits):');
    const { data: byPhone, error: phoneError } = await supabase
        .from('clients')
        .select('id, full_name, phone_number, secondary_phone_number')
        .or(`phone_number.eq.${phone},secondary_phone_number.eq.${phone}`);

    if (phoneError) {
        console.log('   Error:', phoneError.message);
    } else if (!byPhone || byPhone.length === 0) {
        console.log('   Result: NO MATCH (same as what the API returns)\n');
    } else {
        console.log('   Result:', byPhone.length, 'client(s) found');
        byPhone.forEach((c) => console.log('   -', c.id, c.full_name, '| phone:', c.phone_number, '| secondary:', c.secondary_phone_number));
        console.log('');
    }

    // 2. Same as updated API: fetch clients, filter by phoneMatches (normalized)
    console.log('2. New API logic (fetch + filter by normalized phone):');
    const { data: allWithPhones, error: fetchError } = await supabase
        .from('clients')
        .select('id, full_name, phone_number, secondary_phone_number')
        .limit(10000);

    if (fetchError) {
        console.log('   Error:', fetchError.message);
        return;
    }

    const byNormalized = (allWithPhones ?? []).filter((c) => {
        const p1 = normalizePhone(c.phone_number);
        const p2 = normalizePhone(c.secondary_phone_number);
        return (p1 && p1.includes(phone) || p1 === phone) || (p2 && (p2.includes(phone) || p2 === phone));
    });

    // Also try normalized match (same logic as updated API - phoneMatches)
    const { phoneMatches } = await import('../app/api/retell/_lib/phone-utils');
    const exactMatch = (allWithPhones ?? []).filter((c) =>
        phoneMatches(c.phone_number, phone) || phoneMatches(c.secondary_phone_number, phone)
    );

    if (exactMatch.length > 0) {
        console.log('   Clients that the updated API would find (normalized match):');
        exactMatch.forEach((c) => {
            const rawP = c.phone_number;
            const rawS = c.secondary_phone_number;
            console.log('   -', c.id, c.full_name);
            console.log('     phone_number (raw):', JSON.stringify(rawP), '-> normalized:', normalizePhone(rawP));
            console.log('     secondary_phone (raw):', JSON.stringify(rawS), '-> normalized:', normalizePhone(rawS));
        });
    } else if (byNormalized.length > 0) {
        console.log('   No exact normalized match. Clients whose raw phone CONTAINS digits:', phone);
        byNormalized.slice(0, 10).forEach((c) => {
            console.log('   -', c.id, c.full_name, '| raw phone:', JSON.stringify(c.phone_number), '| secondary:', JSON.stringify(c.secondary_phone_number));
        });
    } else {
        console.log('   No clients found with those digits in phone or secondary_phone.');
    }

    // 3. Sample of how phone numbers are stored in the DB
    console.log('\n3. Sample of phone formats in clients table (first 10 with non-null phone):');
    const { data: sample } = await supabase
        .from('clients')
        .select('id, full_name, phone_number, secondary_phone_number')
        .not('phone_number', 'is', null)
        .limit(10);

    (sample ?? []).forEach((c) => {
        const raw = c.phone_number;
        const norm = normalizePhone(raw);
        const match = norm === phone ? ' <-- MATCHES YOUR SEARCH' : '';
        console.log('   -', c.id, '| raw:', JSON.stringify(raw), '| normalized:', norm, match);
    });

    // 4. Summary
    console.log('\n--- Summary ---');
    if (exactMatch.length > 0 && (!byPhone || byPhone.length === 0)) {
        console.log('The updated API uses normalized phone matching and would find these clients.');
        console.log('(Old exact-match query would fail because DB stores formatted numbers.)');
    } else if (byPhone && byPhone.length > 0) {
        console.log('Client(s) found. API should return them. If you still see no_client_found,');
        console.log('check that the request body/args are correct.');
    } else {
        console.log('No client in DB has phone/secondary_phone whose digits match', phone);
        console.log('Try another phone number or check the clients table.');
    }
}

main().catch(console.error);
