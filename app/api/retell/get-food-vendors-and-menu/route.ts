import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRetellSignature } from '../_lib/verify-retell';

const LOG = '[retell:get-food-vendors-and-menu]';

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

    const { data: client, error: clientErr } = await supabase
        .from('clients')
        .select('approved_meals_per_week, service_type, upcoming_order')
        .eq('id', clientId.trim())
        .single();
    if (clientErr || !client) {
        console.error(LOG, 'client not found', { clientId, error: clientErr?.message ?? clientErr, code: clientErr?.code });
        return NextResponse.json({ success: false, error: 'client_not_found', message: 'Client not found.' }, { status: 200 });
    }
    console.log(LOG, 'client found', { service_type: client.service_type, approved_meals_per_week: client.approved_meals_per_week });
    if ((client.service_type ?? '').toString() !== 'Food') {
        console.error(LOG, 'not a Food client', { clientId, service_type: client.service_type });
        return NextResponse.json({ success: false, error: 'not_food_client', message: 'This client is not a Food client.' }, { status: 200 });
    }
    const approvedMeals = Math.max(0, Number(client.approved_meals_per_week) || 0);

    const { data: vendors, error: vErr } = await supabase
        .from('vendors')
        .select('id, name, minimum_meals, delivery_days')
        .eq('service_type', 'Food')
        .eq('is_active', true);
    if (vErr) {
        console.error(LOG, 'failed to load vendors', { error: vErr.message, code: vErr.code });
        return NextResponse.json({ success: false, error: 'database_error', message: 'Failed to load vendors.' }, { status: 500 });
    }
    const vendorList = vendors ?? [];
    const vendorIds = vendorList.map((v: any) => v.id);
    console.log(LOG, 'vendors loaded', { count: vendorList.length, vendorIds: vendorIds.length ? vendorIds.slice(0, 3) : [] });

    const { data: menuItems, error: menuErr } = await supabase
        .from('menu_items')
        .select('id, name, value, vendor_id')
        .in('vendor_id', vendorIds.length ? vendorIds : ['00000000-0000-0000-0000-000000000000']);
    if (menuErr) {
        console.error(LOG, 'failed to load menu_items', { error: menuErr.message, code: menuErr.code });
        return NextResponse.json({ success: false, error: 'database_error', message: 'Failed to load menu items.' }, { status: 500 });
    }
    console.log(LOG, 'menu_items loaded', { count: (menuItems ?? []).length });
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

    const uo = client?.upcoming_order as Record<string, unknown> | null | undefined;
    let currentSelections: Array<{ vendorId: string; items: Record<string, number>; itemNotes?: Record<string, string> }> | null = null;
    let currentSelectionsByDay: Record<string, Array<{ vendorId: string; items: Record<string, number>; itemNotes?: Record<string, string> }>> | null = null;

    if (uo && typeof uo === 'object') {
        const ddo = uo.deliveryDayOrders;
        if (ddo != null && typeof ddo === 'object' && !Array.isArray(ddo)) {
            currentSelectionsByDay = {};
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            for (const day of days) {
                const dayData = (ddo as Record<string, unknown>)[day];
                if (dayData && typeof dayData === 'object' && Array.isArray((dayData as any).vendorSelections)) {
                    currentSelectionsByDay[day] = (dayData as any).vendorSelections;
                }
            }
            if (Object.keys(currentSelectionsByDay).length === 0) currentSelectionsByDay = null;
            else {
                const firstDay = Object.keys(currentSelectionsByDay).sort()[0];
                currentSelections = currentSelectionsByDay[firstDay] ?? null;
            }
        }
        if (!currentSelections && Array.isArray(uo.vendorSelections)) {
            currentSelections = uo.vendorSelections as Array<{ vendorId: string; items: Record<string, number>; itemNotes?: Record<string, string> }>;
        }
    }

    const vendorsPayload = vendorList.map((v: any) => ({
        vendor_id: v.id,
        vendor_name: (v.name ?? '').toString(),
        minimum_meals: Math.max(0, Number(v.minimum_meals) || 0),
        delivery_days: Array.isArray(v.delivery_days) ? v.delivery_days : (v.delivery_days ? [v.delivery_days] : []),
        items: itemsByVendor.get(v.id) ?? []
    }));

    console.log(LOG, 'success', { clientId, vendorsCount: vendorsPayload.length, approvedMeals });
    return NextResponse.json({
        success: true,
        approved_meals_per_week: approvedMeals,
        current_total_used: 0,
        vendors: vendorsPayload,
        current_selections: currentSelections,
        ...(currentSelectionsByDay ? { current_selections_by_day: currentSelectionsByDay } : {})
    });
}
