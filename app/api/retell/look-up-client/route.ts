import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRetellSignature } from '../_lib/verify-retell';
import { normalizePhone, phoneMatches, escapeForIlike } from '../_lib/phone-utils';

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const signature = request.headers.get('x-retell-signature');
    if (!verifyRetellSignature(rawBody, signature)) {
        return NextResponse.json({ success: false, error: 'unauthorized', message: 'Invalid signature' }, { status: 401 });
    }
    let body: { name?: string; args?: { phone_number?: string; full_name?: string }; call?: unknown };
    try {
        body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
        return NextResponse.json({ success: false, error: 'invalid_body', message: 'Invalid JSON' }, { status: 400 });
    }
    const args = body.args ?? {};
    const phone = normalizePhone(args.phone_number);
    const fullName = (args.full_name ?? '').trim();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (phone) {
        // Fetch clients; filter by normalized phone match to handle formatted numbers
        // (e.g. DB has "(845) 782-6353", search is "8457826353") and US country code edge cases
        const { data: candidates, error: phoneError } = await supabase
            .from('clients')
            .select('id, full_name, phone_number, secondary_phone_number, address, service_type, approved_meals_per_week, expiration_date')
            .limit(10000);
        if (phoneError) {
            return NextResponse.json({ success: false, error: 'database_error', message: 'Lookup failed.' }, { status: 500 });
        }
        const list = (candidates ?? [])
            .filter((r: { id?: string; phone_number?: string | null; secondary_phone_number?: string | null }) => {
                if (!r.id) return false;
                return phoneMatches(r.phone_number, phone) || phoneMatches(r.secondary_phone_number, phone);
            });
        if (list.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'no_client_found',
                message: 'No client was found matching that information. Please try again with a different phone number or name.'
            }, { status: 200 });
        }
        if (list.length === 1) {
            const c = list[0];
            return NextResponse.json({
                success: true,
                multiple_matches: false,
                client_id: c.id,
                full_name: c.full_name ?? '',
                phone_number: (c.phone_number ?? '').replace(/\D/g, ''),
                secondary_phone_number: (c.secondary_phone_number ?? '').replace(/\D/g, ''),
                address: c.address ?? '',
                service_type: c.service_type ?? '',
                approved_meals_per_week: c.approved_meals_per_week ?? 0,
                expiration_date: c.expiration_date ?? null
            });
        }
        return NextResponse.json({
            success: true,
            multiple_matches: true,
            message: 'Multiple clients found for this phone number. Ask the caller which profile they want to work with.',
            clients: list.map((c: any, i: number) => ({
                index: i + 1,
                client_id: c.id,
                full_name: c.full_name ?? '',
                address: c.address ?? '',
                service_type: c.service_type ?? ''
            }))
        });
    }

    if (!fullName) {
        return NextResponse.json({
            success: false,
            error: 'no_client_found',
            message: 'No client was found matching that information. Please try again with a different phone number or name.'
        }, { status: 200 });
    }

    const { data: byName, error: nameError } = await supabase
        .from('clients')
        .select('id, full_name, phone_number, secondary_phone_number, address, service_type, approved_meals_per_week, expiration_date')
        .ilike('full_name', `%${escapeForIlike(fullName)}%`);
    if (nameError) {
        return NextResponse.json({ success: false, error: 'database_error', message: 'Lookup failed.' }, { status: 500 });
    }
    const nameList = (byName ?? []).filter((r: { id?: string }) => r.id);
    if (nameList.length === 0) {
        return NextResponse.json({
            success: false,
            error: 'no_client_found',
            message: 'No client was found matching that information. Please try again with a different phone number or name.'
        }, { status: 200 });
    }
    if (nameList.length === 1) {
        const c = nameList[0];
        return NextResponse.json({
            success: true,
            multiple_matches: false,
            client_id: c.id,
            full_name: c.full_name ?? '',
            phone_number: (c.phone_number ?? '').replace(/\D/g, ''),
            secondary_phone_number: (c.secondary_phone_number ?? '').replace(/\D/g, ''),
            address: c.address ?? '',
            service_type: c.service_type ?? '',
            approved_meals_per_week: c.approved_meals_per_week ?? 0,
            expiration_date: c.expiration_date ?? null
        });
    }
    return NextResponse.json({
        success: true,
        multiple_matches: true,
        message: 'Multiple clients found with a similar name. List them with numbers so the caller can pick.',
        clients: nameList.map((c: any, i: number) => ({
            index: i + 1,
            client_id: c.id,
            full_name: c.full_name ?? '',
            address: c.address ?? '',
            service_type: c.service_type ?? ''
        }))
    });
}
