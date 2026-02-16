import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRetellSignature } from '../_lib/verify-retell';
import { normalizePhone, escapeForIlike } from '../_lib/phone-utils';
import { lookupByPhone } from '../_lib/lookup-by-phone';

const LOG = '[retell:look-up-client]';

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const signature = request.headers.get('x-retell-signature');
    console.log(LOG, 'request received');
    if (!verifyRetellSignature(rawBody, signature)) {
        console.error(LOG, 'auth failed: invalid or missing signature');
        return NextResponse.json({ success: false, error: 'unauthorized', message: 'Invalid signature' }, { status: 401 });
    }
    let body: {
        name?: string;
        args?: { phone_number?: string; full_name?: string; phoneNumber?: string; fullName?: string; phone?: string };
        call?: { from_number?: string; to_number?: string; call_type?: string; [k: string]: unknown };
    };
    try {
        body = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
        console.error(LOG, 'invalid JSON body', e);
        return NextResponse.json({ success: false, error: 'invalid_body', message: 'Invalid JSON' }, { status: 400 });
    }
    const args = body.args ?? {};
    // Retell sends phone_number from JSON schema; accept camelCase/alternates and fallback to call.from_number (caller ID)
    const phoneFromArgs =
        args.phone_number ?? args.phoneNumber ?? args.phone ?? '';
    let phone = normalizePhone(phoneFromArgs);
    if (!phone && body.call && typeof body.call === 'object' && body.call.from_number) {
        phone = normalizePhone(body.call.from_number);
        console.log(LOG, 'using call.from_number as fallback (args had no phone)');
    }
    const fullName = (args.full_name ?? args.fullName ?? '').trim();
    console.log(LOG, 'input', {
        argsKeys: Object.keys(args),
        phone: phone ? `${phone.slice(-4)}****` : null,
        hasFullName: !!fullName
    });

    if (phone) {
        const result = await lookupByPhone(phone);
        console.log(LOG, 'lookupByPhone result', { success: result.success, multiple_matches: result.success ? result.multiple_matches : undefined, error: !result.success ? result.error : undefined, message: !result.success ? result.message : undefined });
        if (result.success && !result.multiple_matches) {
            const c = result.client;
            console.log(LOG, 'single phone match, returning client', c.id);
            return NextResponse.json({
                success: true,
                multiple_matches: false,
                client_id: c.id,
                full_name: c.full_name,
                phone_number: c.phone_number,
                secondary_phone_number: c.secondary_phone_number,
                address: c.address,
                service_type: c.service_type,
                approved_meals_per_week: c.approved_meals_per_week,
                expiration_date: c.expiration_date
            });
        }
        if (result.success && result.multiple_matches) {
            console.log(LOG, 'multiple phone matches', result.clients?.length);
            return NextResponse.json({
                success: true,
                multiple_matches: true,
                message: 'Multiple clients found for this phone number. Ask the caller which profile they want to work with.',
                clients: result.clients
            });
        }
        console.log(LOG, 'responding: phone lookup failed or no match', result);
        return NextResponse.json({
            success: result.success,
            error: result.error,
            message: result.message
        }, { status: 200 });
    }

    if (!fullName) {
        console.log(LOG, 'no phone and no fullName -> no_client_found');
        return NextResponse.json({
            success: false,
            error: 'no_client_found',
            message: 'No client was found matching that information. Please try again with a different phone number or name.'
        }, { status: 200 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(LOG, 'looking up by name', { fullNameLength: fullName.length });
    const { data: byName, error: nameError } = await supabase
        .from('clients')
        .select('id, full_name, phone_number, secondary_phone_number, address, service_type, approved_meals_per_week, expiration_date')
        .ilike('full_name', `%${escapeForIlike(fullName)}%`);
    if (nameError) {
        console.error(LOG, 'database error on name lookup', nameError);
        return NextResponse.json({ success: false, error: 'database_error', message: 'Lookup failed.' }, { status: 500 });
    }
    const nameList = (byName ?? []).filter((r: { id?: string }) => r.id);
    console.log(LOG, 'name lookup count', nameList.length);
    if (nameList.length === 0) {
        return NextResponse.json({
            success: false,
            error: 'no_client_found',
            message: 'No client was found matching that information. Please try again with a different phone number or name.'
        }, { status: 200 });
    }
    if (nameList.length === 1) {
        const c = nameList[0];
        console.log(LOG, 'single name match, returning client', c.id);
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
    console.log(LOG, 'multiple name matches', nameList.length);
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
