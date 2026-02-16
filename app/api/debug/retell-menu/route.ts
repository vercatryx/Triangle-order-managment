import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Debug endpoint for Retell "get food vendors and menu" flow.
 * No Retell signature required — use from browser or Postman to see exactly where it fails.
 *
 * GET /api/debug/retell-menu?client_id=<uuid>
 *
 * Returns a detailed report: client lookup, service_type check, vendors count, menu_items count,
 * and the same payload shape the real Retell endpoint would return (or the error step).
 */
export async function GET(request: NextRequest) {
    const clientId = request.nextUrl.searchParams.get('client_id') ?? '';
    if (!clientId.trim()) {
        return NextResponse.json({
            ok: false,
            error: 'missing_client_id',
            message: 'Add ?client_id=<your-food-client-uuid>',
            steps: { client: null, vendors: null, menu_items: null }
        }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json({
            ok: false,
            error: 'config',
            message: 'Missing Supabase env vars',
            steps: {}
        }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const steps: Record<string, unknown> = {};

    // Step 1: client
    const { data: client, error: clientErr } = await supabase
        .from('clients')
        .select('id, full_name, service_type, approved_meals_per_week, upcoming_order')
        .eq('id', clientId.trim())
        .single();

    if (clientErr || !client) {
        return NextResponse.json({
            ok: false,
            error: 'client_not_found',
            message: clientErr?.message ?? 'Client not found',
            steps: { client: { error: clientErr?.message, code: clientErr?.code } }
        }, { status: 200 });
    }

    steps.client = {
        found: true,
        service_type: client.service_type,
        approved_meals_per_week: client.approved_meals_per_week,
        full_name: client.full_name
    };

    if ((client.service_type ?? '').toString() !== 'Food') {
        return NextResponse.json({
            ok: false,
            error: 'not_food_client',
            message: `Client service_type is "${client.service_type}", not "Food". Menu is only for Food clients.`,
            steps
        }, { status: 200 });
    }

    // Step 2: vendors
    const { data: vendors, error: vErr } = await supabase
        .from('vendors')
        .select('id, name, minimum_meals, delivery_days')
        .eq('service_type', 'Food')
        .eq('is_active', true);

    if (vErr) {
        return NextResponse.json({
            ok: false,
            error: 'database_error',
            message: 'Failed to load vendors: ' + (vErr.message ?? ''),
            steps: { ...steps, vendors: { error: vErr.message, code: vErr.code } }
        }, { status: 200 });
    }

    const vendorList = vendors ?? [];
    const vendorIds = vendorList.map((v: { id: string }) => v.id);
    steps.vendors = { count: vendorList.length, ids: vendorIds.slice(0, 5), names: vendorList.map((v: { name?: string }) => v.name ?? '') };

    if (vendorList.length === 0) {
        return NextResponse.json({
            ok: false,
            error: 'no_food_vendors',
            message: 'No active Food vendors in the database. Add vendors with service_type "Food" and is_active true.',
            steps
        }, { status: 200 });
    }

    // Step 3: menu_items
    const { data: menuItems, error: menuErr } = await supabase
        .from('menu_items')
        .select('id, name, value, vendor_id')
        .in('vendor_id', vendorIds);

    if (menuErr) {
        return NextResponse.json({
            ok: false,
            error: 'database_error',
            message: 'Failed to load menu items: ' + (menuErr.message ?? ''),
            steps: { ...steps, menu_items: { error: menuErr.message, code: menuErr.code } }
        }, { status: 200 });
    }

    const itemsByVendor = new Map<string, Array<{ item_id: string; name: string; meal_value: number }>>();
    for (const mi of menuItems ?? []) {
        const vid = (mi as { vendor_id?: string }).vendor_id ?? '';
        if (!vid) continue;
        const list = itemsByVendor.get(vid) ?? [];
        list.push({
            item_id: (mi as { id: string }).id,
            name: ((mi as { name?: string }).name ?? 'Item').toString(),
            meal_value: Math.max(1, Number((mi as { value?: number }).value) || 1)
        });
        itemsByVendor.set(vid, list);
    }

    steps.menu_items = {
        total: (menuItems ?? []).length,
        by_vendor: Object.fromEntries(
            vendorList.slice(0, 5).map((v: { id: string }) => [v.id, (itemsByVendor.get(v.id) ?? []).length])
        )
    };

    const vendorsPayload = vendorList.map((v: { id: string; name?: string; minimum_meals?: number; delivery_days?: unknown }) => ({
        vendor_id: v.id,
        vendor_name: (v.name ?? '').toString(),
        minimum_meals: Math.max(0, Number(v.minimum_meals) || 0),
        delivery_days: Array.isArray(v.delivery_days) ? v.delivery_days : (v.delivery_days ? [v.delivery_days] : []),
        items: itemsByVendor.get(v.id) ?? []
    }));

    return NextResponse.json({
        ok: true,
        message: 'Menu flow succeeded — same shape as Retell get-food-vendors-and-menu',
        steps,
        payload: {
            success: true,
            approved_meals_per_week: Math.max(0, Number(client.approved_meals_per_week) || 0),
            current_total_used: 0,
            vendors_count: vendorsPayload.length,
            vendors: vendorsPayload,
            current_selections: (client.upcoming_order && typeof client.upcoming_order === 'object' && Array.isArray((client.upcoming_order as { vendorSelections?: unknown[] }).vendorSelections))
                ? (client.upcoming_order as { vendorSelections: unknown[] }).vendorSelections
                : null
        }
    });
}
