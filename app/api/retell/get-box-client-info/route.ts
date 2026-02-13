import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRetellSignature } from '../_lib/verify-retell';

export async function GET(request: NextRequest) {
    const signature = request.headers.get('x-retell-signature');
    const rawBody = await request.text().catch(() => '');
    if (signature && !verifyRetellSignature(rawBody, signature)) {
        return NextResponse.json({ success: false, error: 'unauthorized', message: 'Invalid signature' }, { status: 401 });
    }
    const clientId = request.nextUrl.searchParams.get('client_id') ?? '';
    if (!clientId.trim()) {
        return NextResponse.json({ success: false, error: 'missing_client_id', message: 'client_id is required.' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: client, error: clientErr } = await supabase
        .from('clients')
        .select('approved_meals_per_week, service_type, upcoming_order')
        .eq('id', clientId.trim())
        .single();
    if (clientErr || !client) {
        return NextResponse.json({ success: false, error: 'client_not_found', message: 'Client not found.' }, { status: 200 });
    }
    if ((client.service_type ?? '').toString() !== 'Boxes') {
        return NextResponse.json({ success: false, error: 'not_box_client', message: 'This client is not a Box client.' }, { status: 200 });
    }
    const totalBoxes = Math.max(0, Number(client.approved_meals_per_week) || 0);
    if (totalBoxes === 0) {
        return NextResponse.json({ success: false, error: 'no_boxes', message: 'This client has no boxes authorized.' }, { status: 200 });
    }

    const { data: boxTypes, error: btErr } = await supabase.from('box_types').select('id, name').eq('is_active', true);
    if (btErr || !boxTypes?.length) {
        return NextResponse.json({ success: false, error: 'no_box_types', message: 'No box types configured.' }, { status: 200 });
    }
    const boxType = boxTypes[0];
    const boxTypeId = boxType.id;
    const boxTypeName = (boxType.name ?? 'Box').toString();

    const { data: boxQuotas } = await supabase.from('box_quotas').select('category_id, target_value').eq('box_type_id', boxTypeId);
    const quotaByCategory = new Map<string, number>();
    for (const q of boxQuotas ?? []) {
        if (q.category_id) quotaByCategory.set(q.category_id, Number(q.target_value) || 0);
    }

    const { data: cats } = await supabase.from('item_categories').select('id, name, set_value').order('sort_order', { ascending: true }).order('name');
    const categoryIds = (cats ?? []).map((c: any) => c.id);

    const { data: menuItems } = await supabase
        .from('menu_items')
        .select('id, name, value, category_id')
        .in('category_id', categoryIds.length ? categoryIds : ['00000000-0000-0000-0000-000000000000']);
    const itemsByCategory = new Map<string, Array<{ item_id: string; name: string; point_value: number }>>();
    for (const mi of menuItems ?? []) {
        const cid = mi.category_id ?? '';
        if (!cid) continue;
        const list = itemsByCategory.get(cid) ?? [];
        list.push({
            item_id: mi.id,
            name: (mi.name ?? 'Item').toString(),
            point_value: Number(mi.value) || 0
        });
        itemsByCategory.set(cid, list);
    }

    const categoriesPayload = (cats ?? []).map((c: any) => ({
        category_id: c.id,
        category_name: (c.name ?? '').toString(),
        required_points: quotaByCategory.has(c.id) ? quotaByCategory.get(c.id)! : (Number(c.set_value) || 0),
        items: itemsByCategory.get(c.id) ?? []
    }));

    const uo = client.upcoming_order as Record<string, unknown> | null;
    const boxOrders = (uo && Array.isArray((uo as any).boxOrders)) ? (uo as any).boxOrders : [];
    const currentSelectionsByBox: Array<Record<string, unknown> | null> = [];
    for (let i = 0; i < totalBoxes; i++) {
        const bo = boxOrders[i];
        currentSelectionsByBox.push(bo ? { box_index: i + 1, box_type_id: bo.boxTypeId ?? bo.box_type_id, category_selections: bo.category_selections ?? [] } : null);
    }

    const boxes = Array.from({ length: totalBoxes }, (_, i) => ({
        box_index: i + 1,
        box_type_id: boxTypeId,
        box_type_name: boxTypeName,
        categories: categoriesPayload,
        current_selections: currentSelectionsByBox[i] ?? null
    }));

    return NextResponse.json({
        success: true,
        total_boxes: totalBoxes,
        boxes
    });
}
