import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRetellSignature } from '../_lib/verify-retell';

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const signature = request.headers.get('x-retell-signature');
    if (!verifyRetellSignature(rawBody, signature)) {
        return NextResponse.json({ success: false, error: 'unauthorized', message: 'Invalid signature' }, { status: 401 });
    }
    let body: { name?: string; args?: { client_id?: string }; call?: unknown };
    try {
        body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
        return NextResponse.json({ success: false, error: 'invalid_body', message: 'Invalid JSON' }, { status: 400 });
    }
    const clientId = (body.args?.client_id ?? '').trim();
    if (!clientId) {
        return NextResponse.json({ success: false, error: 'missing_client_id', message: 'client_id is required.' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: c, error } = await supabase
        .from('clients')
        .select('id, full_name, phone_number, secondary_phone_number, address, service_type, approved_meals_per_week, expiration_date')
        .eq('id', clientId)
        .single();

    if (error || !c) {
        return NextResponse.json({ success: false, error: 'no_client_found', message: 'That client could not be found.' }, { status: 200 });
    }

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
