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
    if ((client.service_type ?? '').toString() !== 'Food') {
        return NextResponse.json({ success: false, error: 'not_food_client', message: 'This client is not a Food client.' }, { status: 200 });
    }
    const approvedMeals = Math.max(0, Number(client.approved_meals_per_week) || 0);

    const { data: vendors, error: vErr } = await supabase
        .from('vendors')
        .select('id, name, minimum_meals, delivery_days')
        .eq('service_type', 'Food')
        .eq('is_active', true);
    if (vErr) {
        return NextResponse.json({ success: false, error: 'database_error', message: 'Failed to load vendors.' }, { status: 500 });
    }
    const vendorList = vendors ?? [];
    const vendorIds = vendorList.map((v: any) => v.id);

    const { data: menuItems } = await supabase
        .from('menu_items')
        .select('id, name, value, vendor_id')
        .in('vendor_id', vendorIds.length ? vendorIds : ['00000000-0000-0000-0000-000000000000']);
    const itemsByVendor = new Map<string, Array<{ item_id: string; name: string; meal_value: number }>>();
    for (const mi of menuItems ?? []) {
        const vid = mi.vendor_id ?? '';
        if (!vid) continue;
        const list = itemsByVendor.get(vid) ?? [];
        list.push({
            item_id: mi.id,
            name: (mi.name ?? 'Item').toString(),
            meal_value: Math.max(1, Number(mi.value) || 1)
        });
        itemsByVendor.set(vid, list);
    }

    const uo = client?.upcoming_order;
    const currentSelections = (uo && typeof uo === 'object' && Array.isArray((uo as any).vendorSelections)) ? (uo as any).vendorSelections : null;

    const vendorsPayload = vendorList.map((v: any) => ({
        vendor_id: v.id,
        vendor_name: (v.name ?? '').toString(),
        minimum_meals: Math.max(0, Number(v.minimum_meals) || 0),
        delivery_days: Array.isArray(v.delivery_days) ? v.delivery_days : (v.delivery_days ? [v.delivery_days] : []),
        items: itemsByVendor.get(v.id) ?? []
    }));

    return NextResponse.json({
        success: true,
        approved_meals_per_week: approvedMeals,
        current_total_used: 0,
        vendors: vendorsPayload,
        current_selections: currentSelections
    });
}
