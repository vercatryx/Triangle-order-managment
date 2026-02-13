import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRetellSignature } from '../_lib/verify-retell';

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const signature = request.headers.get('x-retell-signature');
    if (!verifyRetellSignature(rawBody, signature)) {
        return NextResponse.json({ success: false, error: 'unauthorized', message: 'Invalid signature' }, { status: 401 });
    }
    let body: { name?: string; args?: { client_id?: string; vendor_selections?: any[] }; call?: unknown };
    try {
        body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
        return NextResponse.json({ success: false, error: 'invalid_body', message: 'Invalid JSON' }, { status: 400 });
    }
    const clientId = (body.args?.client_id ?? '').trim();
    const vendorSelections = Array.isArray(body.args?.vendor_selections) ? body.args.vendor_selections : [];
    if (!clientId) {
        return NextResponse.json({ success: false, error: 'missing_client_id', message: 'client_id is required.' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: client, error: clientErr } = await supabase
        .from('clients')
        .select('id, approved_meals_per_week, service_type')
        .eq('id', clientId)
        .single();
    if (clientErr || !client) {
        return NextResponse.json({ success: false, error: 'client_not_found', message: 'Client not found.' }, { status: 200 });
    }
    if ((client.service_type ?? '').toString() !== 'Food') {
        return NextResponse.json({ success: false, error: 'not_food_client', message: 'This client is not a Food client.' }, { status: 200 });
    }
    const approvedMeals = Math.max(0, Number(client.approved_meals_per_week) || 0);

    const { data: vendors } = await supabase.from('vendors').select('id, name, minimum_meals').in('id', vendorSelections.map((v: any) => v.vendor_id).filter(Boolean));
    const vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, { name: v.name, minimum_meals: Math.max(0, Number(v.minimum_meals) || 0) }]));
    const { data: menuItems } = await supabase.from('menu_items').select('id, value, vendor_id');
    const itemValueMap = new Map<string, number>();
    for (const m of menuItems ?? []) {
        itemValueMap.set(m.id, Math.max(1, Number(m.value) || 1));
    }

    const vendorErrors: Array<{ vendor_id: string; vendor_name: string; minimum: number; selected: number }> = [];
    let totalMeals = 0;
    const vendorSelectionsPayload: Array<{ vendorId: string; items: Record<string, number> }> = [];

    for (const vs of vendorSelections) {
        const vendorId = (vs.vendor_id ?? '').toString();
        const vendorInfo = vendorMap.get(vendorId);
        const minimum = vendorInfo ? vendorInfo.minimum_meals : 0;
        const vendorName = vendorInfo ? vendorInfo.name : vendorId;
        const itemList = Array.isArray(vs.items) ? vs.items : [];
        const items: Record<string, number> = {};
        let vendorMeals = 0;
        for (const it of itemList) {
            const itemId = (it.item_id ?? '').toString();
            const qty = Math.max(0, Number(it.quantity) || 0);
            if (itemId && qty > 0) {
                const mealVal = itemValueMap.get(itemId) ?? 1;
                vendorMeals += mealVal * qty;
                items[itemId] = (items[itemId] ?? 0) + qty;
            }
        }
        totalMeals += vendorMeals;
        if (minimum > 0 && vendorMeals < minimum) {
            vendorErrors.push({ vendor_id: vendorId, vendor_name: vendorName, minimum, selected: vendorMeals });
        }
        if (Object.keys(items).length > 0) {
            vendorSelectionsPayload.push({ vendorId, items });
        }
    }

    if (vendorErrors.length > 0) {
        return NextResponse.json({
            success: false,
            error: 'validation_failed',
            message: vendorErrors.map(e => `${e.vendor_name} requires a minimum of ${e.minimum} meals but only ${e.selected} were selected.`).join(' '),
            details: {
                vendor_errors: vendorErrors,
                total_selected: totalMeals,
                approved_meals_per_week: approvedMeals,
                over_limit: totalMeals > approvedMeals
            }
        }, { status: 200 });
    }
    if (totalMeals > approvedMeals) {
        return NextResponse.json({
            success: false,
            error: 'validation_failed',
            message: `Total meals (${totalMeals}) exceed the approved limit of ${approvedMeals} per week.`,
            details: {
                vendor_errors: [],
                total_selected: totalMeals,
                approved_meals_per_week: approvedMeals,
                over_limit: true
            }
        }, { status: 200 });
    }

    const upcomingOrder = {
        serviceType: 'Food',
        vendorSelections: vendorSelectionsPayload
    };

    const { error: updateErr } = await supabase
        .from('clients')
        .update({ upcoming_order: upcomingOrder })
        .eq('id', clientId);

    if (updateErr) {
        return NextResponse.json({ success: false, error: 'database_error', message: 'Failed to save order.' }, { status: 500 });
    }
    const parts = vendorSelectionsPayload.map(v => {
        const vendorName = vendorMap.get(v.vendorId)?.name ?? v.vendorId;
        const count = Object.values(v.items).reduce((a, b) => a + b, 0);
        return `${count} meals from ${vendorName}`;
    });
    return NextResponse.json({
        success: true,
        message: `Food order saved successfully. ${parts.join(' and ')}. Total: ${totalMeals} of ${approvedMeals} approved meals per week used.`
    });
}
