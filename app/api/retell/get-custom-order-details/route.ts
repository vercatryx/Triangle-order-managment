import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRetellSignature } from '../_lib/verify-retell';

const LOG = '[retell:get-custom-order-details]';

export async function GET(request: NextRequest) {
    const signature = request.headers.get('x-retell-signature');
    const rawBody = await request.text().catch(() => '');
    console.log(LOG, 'request received');
    if (signature && !verifyRetellSignature(rawBody, signature)) {
        console.error(LOG, 'auth failed: invalid or missing signature');
        return NextResponse.json({ success: false, error: 'unauthorized', message: 'Invalid signature' }, { status: 401 });
    }
    const clientId = request.nextUrl.searchParams.get('client_id') ?? '';
    if (!clientId.trim()) {
        console.error(LOG, 'missing client_id');
        return NextResponse.json({ success: false, error: 'missing_client_id', message: 'client_id is required.' }, { status: 400 });
    }
    console.log(LOG, 'client_id', clientId);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: row, error } = await supabase
        .from('clients')
        .select('upcoming_order, service_type')
        .eq('id', clientId.trim())
        .single();

    if (error || !row) {
        console.error(LOG, 'client not found', { clientId, error });
        return NextResponse.json({ success: false, error: 'client_not_found', message: 'Client not found.' }, { status: 200 });
    }
    const st = (row.service_type ?? '').toString();
    if (st !== 'Custom') {
        console.error(LOG, 'not a Custom client', { clientId, service_type: st });
        return NextResponse.json({ success: false, error: 'not_custom_client', message: 'This client is not a Custom client.' }, { status: 200 });
    }
    const uo = row.upcoming_order;
    if (!uo || typeof uo !== 'object') {
        return NextResponse.json({
            success: true,
            has_order: false,
            order: null
        });
    }
    const o = uo as Record<string, unknown>;
    const items = Array.isArray(o.items)
        ? (o.items as Array<{ name?: string; quantity?: number; delivery_day?: string }>).map((it: any) => ({
            name: it.name ?? it.custom_name ?? 'Item',
            quantity: typeof it.quantity === 'number' ? it.quantity : 1,
            delivery_day: it.delivery_day ?? null
        }))
        : [];
    const nextDelivery = o.next_delivery_date ?? o.deliveryDay ?? null;
    const notes = o.notes ?? null;
    console.log(LOG, 'success', { clientId, hasOrder: items.length > 0 || !!nextDelivery || !!notes });
    return NextResponse.json({
        success: true,
        has_order: items.length > 0 || nextDelivery || notes,
        order: {
            items,
            next_delivery_date: nextDelivery != null ? String(nextDelivery) : null,
            notes: notes != null ? String(notes) : null
        }
    });
}
