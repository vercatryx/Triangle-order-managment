import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRetellSignature } from '../_lib/verify-retell';

const LOG = '[retell:select-client]';

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const signature = request.headers.get('x-retell-signature');
    console.log(LOG, 'request received');
    if (!verifyRetellSignature(rawBody, signature)) {
        console.error(LOG, 'auth failed: invalid or missing signature');
        return NextResponse.json({ success: false, error: 'unauthorized', message: 'Invalid signature' }, { status: 401 });
    }
    let body: { name?: string; args?: { client_id?: string }; call?: unknown };
    try {
        body = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
        console.error(LOG, 'invalid JSON body', e);
        return NextResponse.json({ success: false, error: 'invalid_body', message: 'Invalid JSON' }, { status: 400 });
    }
    const clientId = (body.args?.client_id ?? '').trim();
    if (!clientId) {
        console.error(LOG, 'missing client_id');
        return NextResponse.json({ success: false, error: 'missing_client_id', message: 'client_id is required.' }, { status: 400 });
    }
    console.log(LOG, 'client_id', clientId);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: c, error } = await supabase
        .from('clients')
        .select('id, full_name, phone_number, secondary_phone_number, address, service_type, approved_meals_per_week, expiration_date')
        .eq('id', clientId)
        .single();

    if (error || !c) {
        console.error(LOG, 'client not found', { clientId, error });
        return NextResponse.json({ success: false, error: 'no_client_found', message: 'That client could not be found.' }, { status: 200 });
    }

    console.log(LOG, 'success', { clientId, full_name: c.full_name });
    return NextResponse.json({
        success: true,
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
