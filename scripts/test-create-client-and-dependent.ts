/**
 * Test script: create one primary client and one dependent using the same
 * ID generation and insert path as the app (with service role).
 *
 * Run from project root:
 *   npx tsx scripts/test-create-client-and-dependent.ts
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

/** Get next CLIENT-NNN id by scanning all CLIENT-% rows (same logic as app fallback). */
async function getNextClientId(afterCollisionId?: string): Promise<string> {
    const pageSize = 1000;
    let allRows: { id: string }[] = [];
    let page = 0;
    while (true) {
        const { data: pageData } = await supabase
            .from('clients')
            .select('id')
            .like('id', 'CLIENT-%')
            .range(page * pageSize, (page + 1) * pageSize - 1);
        if (!pageData || pageData.length === 0) break;
        allRows = allRows.concat(pageData);
        if (pageData.length < pageSize) break;
        page++;
    }
    let minNum = 0;
    if (afterCollisionId) {
        const m = afterCollisionId.match(/CLIENT-(\d+)/);
        if (m) minNum = parseInt(m[1], 10);
    }
    if (allRows.length === 0) {
        return minNum > 0 ? `CLIENT-${(minNum + 1).toString().padStart(3, '0')}` : 'CLIENT-001';
    }
    let maxNum = minNum;
    for (const row of allRows) {
        if (!row.id) continue;
        const match = row.id.match(/CLIENT-(\d+)/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }
    return `CLIENT-${(maxNum + 1).toString().padStart(3, '0')}`;
}

async function run() {
    let primaryId: string | null = null;
    let dependentId: string | null = null;

    console.log('1. Fetching one status_id and one navigator_id...');
    const [statusRes, navRes] = await Promise.all([
        supabase.from('client_statuses').select('id').limit(1).single(),
        supabase.from('navigators').select('id').limit(1).single(),
    ]);
    const statusId = statusRes.data?.id ?? statusRes.error?.message;
    const navigatorId = navRes.data?.id ?? navRes.error?.message;
    if (!statusId || typeof statusId !== 'string') {
        console.error('Could not get status_id:', statusRes.error);
        process.exit(1);
    }
    if (!navigatorId || typeof navigatorId !== 'string') {
        console.error('Could not get navigator_id:', navRes.error);
        process.exit(1);
    }
    console.log('   status_id:', statusId, 'navigator_id:', navigatorId);

    console.log('2. Getting next client ID (primary, via fallback)...');
    primaryId = await getNextClientId();
    console.log('   Primary ID:', primaryId);

    const primaryPayload = {
        id: primaryId,
        full_name: 'Test Primary Client ' + Date.now(),
        email: null,
        address: '123 Test St',
        phone_number: '555-000-0000',
        secondary_phone_number: null,
        navigator_id: navigatorId,
        end_date: '',
        screening_took_place: false,
        screening_signed: false,
        notes: '',
        status_id: statusId,
        service_type: 'Food',
        approved_meals_per_week: 0,
        authorized_amount: null,
        expiration_date: null,
        parent_client_id: null,
        dob: null,
        cin: null,
        upcoming_order: null,
    };

    console.log('3. Inserting primary client...');
    const { data: primaryRow, error: insertPrimaryError } = await supabase
        .from('clients')
        .insert([primaryPayload])
        .select()
        .single();

    if (insertPrimaryError) {
        console.error('   Insert primary failed:', insertPrimaryError.code, insertPrimaryError.message);
        if (insertPrimaryError.code === '23505') {
            console.error('   Duplicate key - the ID', primaryId, 'already exists. Sequence may be behind.');
        }
        process.exit(1);
    }
    console.log('   Primary client created:', primaryRow?.id);

    console.log('4. Getting next client ID (dependent)...');
    dependentId = await getNextClientId();
    console.log('   Dependent ID:', dependentId);

    const dependentPayload = {
        id: dependentId,
        full_name: 'Test Dependent ' + Date.now(),
        email: null,
        address: '',
        phone_number: '',
        secondary_phone_number: null,
        navigator_id: null,
        end_date: '',
        screening_took_place: false,
        screening_signed: false,
        notes: '',
        status_id: null,
        service_type: 'Food',
        approved_meals_per_week: 0,
        authorized_amount: null,
        expiration_date: null,
        parent_client_id: primaryId,
        dob: null,
        cin: null,
        upcoming_order: null,
    };

    console.log('5. Inserting dependent...');
    const { data: dependentRow, error: insertDependentError } = await supabase
        .from('clients')
        .insert([dependentPayload])
        .select()
        .single();

    if (insertDependentError) {
        console.error('   Insert dependent failed:', insertDependentError.code, insertDependentError.message);
        if (insertDependentError.code === '23505') {
            console.error('   Duplicate key - the ID', dependentId, 'already exists.');
        }
        // Clean up primary
        await supabase.from('clients').delete().eq('id', primaryId!);
        process.exit(1);
    }
    console.log('   Dependent created:', dependentRow?.id);

    console.log('6. Cleaning up: deleting dependent and primary...');
    await supabase.from('clients').delete().eq('id', dependentId!);
    await supabase.from('clients').delete().eq('id', primaryId!);
    console.log('   Done.');

    console.log('\n--- SUCCESS: Create client + dependent test passed. ---');
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
