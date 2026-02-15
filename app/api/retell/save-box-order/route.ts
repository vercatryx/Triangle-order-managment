import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRetellSignature } from '../_lib/verify-retell';

const LOG = '[retell:save-box-order]';

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const signature = request.headers.get('x-retell-signature');
    console.log(LOG, 'request received');
    if (!verifyRetellSignature(rawBody, signature)) {
        console.error(LOG, 'auth failed: invalid or missing signature');
        return NextResponse.json({ success: false, error: 'unauthorized', message: 'Invalid signature' }, { status: 401 });
    }
    let body: { name?: string; args?: { client_id?: string; box_selections?: any[] }; call?: unknown };
    try {
        body = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
        console.error(LOG, 'invalid JSON body', e);
        return NextResponse.json({ success: false, error: 'invalid_body', message: 'Invalid JSON' }, { status: 400 });
    }
    const clientId = (body.args?.client_id ?? '').trim();
    const boxSelections = Array.isArray(body.args?.box_selections) ? body.args.box_selections : [];
    if (!clientId) {
        console.error(LOG, 'missing client_id');
        return NextResponse.json({ success: false, error: 'missing_client_id', message: 'client_id is required.' }, { status: 400 });
    }
    console.log(LOG, 'client_id', clientId, 'boxSelections count', boxSelections.length);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: client, error: clientErr } = await supabase
        .from('clients')
        .select('id, approved_meals_per_week, service_type')
        .eq('id', clientId)
        .single();
    if (clientErr || !client) {
        console.error(LOG, 'client not found', { clientId, error: clientErr });
        return NextResponse.json({ success: false, error: 'client_not_found', message: 'Client not found.' }, { status: 200 });
    }
    if ((client.service_type ?? '').toString() !== 'Boxes') {
        console.error(LOG, 'not a Box client', { clientId, service_type: client.service_type });
        return NextResponse.json({ success: false, error: 'not_box_client', message: 'This client is not a Box client.' }, { status: 200 });
    }
    const totalBoxes = Math.max(0, Number(client.approved_meals_per_week) || 0);
    if (boxSelections.length !== totalBoxes) {
        console.error(LOG, 'validation_failed: box count mismatch', { expected: totalBoxes, received: boxSelections.length });
        return NextResponse.json({
            success: false,
            error: 'validation_failed',
            message: `Expected ${totalBoxes} box(es) but received ${boxSelections.length}.`
        }, { status: 200 });
    }

    const firstBoxTypeIdForQuota = (boxSelections[0]?.box_type_id ?? boxSelections[0]?.boxTypeId ?? '').toString();
    const { data: boxQuotas } = await supabase.from('box_quotas').select('category_id, target_value').eq('box_type_id', firstBoxTypeIdForQuota);
    const { data: categories } = await supabase.from('item_categories').select('id, set_value');
    const quotaMap = new Map<string, number>();
    for (const q of boxQuotas ?? []) {
        if (q.category_id) quotaMap.set(q.category_id, Number(q.target_value) || 0);
    }
    for (const c of categories ?? []) {
        if (c.id && !quotaMap.has(c.id)) quotaMap.set(c.id, Number(c.set_value) || 0);
    }
    const { data: menuItems } = await supabase.from('menu_items').select('id, value, category_id');
    const itemPointMap = new Map<string, number>();
    for (const m of menuItems ?? []) {
        itemPointMap.set(m.id, Number(m.value) || 0);
    }

    let firstBoxTypeId = '';
    const boxOrders: Array<{ boxTypeId: string; vendorId?: string; quantity: number; items: Record<string, number> }> = [];
    for (const sel of boxSelections) {
        const boxTypeId = (sel.box_type_id ?? sel.boxTypeId ?? '').toString();
        if (!firstBoxTypeId) firstBoxTypeId = boxTypeId;
        const categorySelections = Array.isArray(sel.category_selections) ? sel.category_selections : [];
        const items: Record<string, number> = {};
        for (const cs of categorySelections) {
            const categoryId = (cs.category_id ?? '').toString();
            const required = quotaMap.get(categoryId) ?? 0;
            const itemList = Array.isArray(cs.items) ? cs.items : [];
            let points = 0;
            for (const it of itemList) {
                const itemId = (it.item_id ?? '').toString();
                const qty = Math.max(0, Number(it.quantity) || 0);
                if (itemId && qty > 0) {
                    const pt = itemPointMap.get(itemId) ?? 0;
                    points += pt * qty;
                    items[itemId] = (items[itemId] ?? 0) + qty;
                }
            }
            if (required > 0 && Math.abs(points - required) > 0.01) {
                console.error(LOG, 'validation_failed: category points', { points, required, categoryId });
                return NextResponse.json({
                    success: false,
                    error: 'validation_failed',
                    message: `Category points do not match required (got ${points}, required ${required}).`
                }, { status: 200 });
            }
        }
        boxOrders.push({
            boxTypeId: boxTypeId || firstBoxTypeId,
            quantity: 1,
            items
        });
    }

    const upcomingOrder = {
        serviceType: 'Boxes',
        boxOrders
    };

    const { error: updateErr } = await supabase
        .from('clients')
        .update({ upcoming_order: upcomingOrder })
        .eq('id', clientId);

    if (updateErr) {
        console.error(LOG, 'database error saving order', updateErr);
        return NextResponse.json({ success: false, error: 'database_error', message: 'Failed to save order.' }, { status: 500 });
    }
    console.log(LOG, 'order saved', { clientId, totalBoxes });
    return NextResponse.json({
        success: true,
        message: `Box order saved successfully for all ${totalBoxes} box(es).`
    });
}
