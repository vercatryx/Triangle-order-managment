import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from '../../retell/_lib/phone-utils';
import { lookupByPhone } from '../../retell/_lib/lookup-by-phone';

/**
 * One-shot Retell debug: run look-up-client then get-food-vendors-and-menu.
 * No Retell signature required.
 *
 * GET /api/debug/retell?phone=8454282954
 *   → Looks up client by phone, then runs menu flow for that client. Returns one report.
 *
 * GET /api/debug/retell?client_id=<uuid>
 *   → Skips lookup, runs menu flow only for the given client_id.
 *
 * Response includes: lookup result (if phone given), then menu steps and payload or error.
 */
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const phoneParam = searchParams.get('phone') ?? '';
    const clientIdParam = searchParams.get('client_id') ?? '';

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json({
            ok: false,
            error: 'config',
            message: 'Missing Supabase env vars'
        }, { status: 500 });
    }

    const report: { lookup?: unknown; menu?: unknown; client_id_used?: string } = {};
    let clientId = clientIdParam.trim();

    if (phoneParam && !clientId) {
        const phone = normalizePhone(phoneParam);
        if (!phone) {
            return NextResponse.json({
                ok: false,
                error: 'invalid_phone',
                message: 'Provide a valid ?phone= number (e.g. 8454282954)'
            }, { status: 400 });
            }
        const lookupResult = await lookupByPhone(phone);
        report.lookup = {
            phone_given: phoneParam,
            success: lookupResult.success,
            multiple_matches: lookupResult.success ? (lookupResult.multiple_matches ?? false) : false,
            client_id: lookupResult.success && !lookupResult.multiple_matches ? lookupResult.client.id : lookupResult.success && lookupResult.multiple_matches && lookupResult.clients?.length ? lookupResult.clients[0].client_id : null,
            error: lookupResult.success ? null : (lookupResult as { error?: string; message?: string }).message ?? (lookupResult as { error?: string; message?: string }).error
        };
        if (lookupResult.success && !lookupResult.multiple_matches && lookupResult.client) {
            clientId = lookupResult.client.id;
        } else if (lookupResult.success && lookupResult.multiple_matches && lookupResult.clients?.length) {
            clientId = lookupResult.clients[0].client_id;
            report.lookup = { ...report.lookup as object, used_first_match: true };
        }
    }

    if (!clientId) {
        return NextResponse.json({
            ok: false,
            message: 'Need either ?phone= or ?client_id= to test menu flow',
            report
        }, { status: 400 });
    }

    report.client_id_used = clientId;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: client, error: clientErr } = await supabase
        .from('clients')
        .select('id, full_name, service_type, approved_meals_per_week, upcoming_order')
        .eq('id', clientId)
        .single();

    if (clientErr || !client) {
        report.menu = { step: 'client', error: 'client_not_found', detail: clientErr?.message };
        return NextResponse.json({ ok: false, report }, { status: 200 });
    }

    if ((client.service_type ?? '').toString() !== 'Food') {
        report.menu = { step: 'service_type', error: 'not_food_client', service_type: client.service_type };
        return NextResponse.json({ ok: false, report }, { status: 200 });
    }

    const { data: vendors, error: vErr } = await supabase
        .from('vendors')
        .select('id, name, minimum_meals, delivery_days')
        .eq('service_type', 'Food')
        .eq('is_active', true);

    if (vErr) {
        report.menu = { step: 'vendors', error: 'database_error', detail: vErr.message };
        return NextResponse.json({ ok: false, report }, { status: 200 });
    }

    const vendorList = vendors ?? [];
    const vendorIds = vendorList.map((v: { id: string }) => v.id);

    if (vendorList.length === 0) {
        report.menu = { step: 'vendors', error: 'no_food_vendors', message: 'No active Food vendors' };
        return NextResponse.json({ ok: false, report }, { status: 200 });
    }

    const { data: menuItems, error: menuErr } = await supabase
        .from('menu_items')
        .select('id, name, value, vendor_id')
        .in('vendor_id', vendorIds);

    if (menuErr) {
        report.menu = { step: 'menu_items', error: 'database_error', detail: menuErr.message };
        return NextResponse.json({ ok: false, report }, { status: 200 });
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

    const vendorsPayload = vendorList.map((v: { id: string; name?: string; minimum_meals?: number; delivery_days?: unknown }) => ({
        vendor_id: v.id,
        vendor_name: (v.name ?? '').toString(),
        minimum_meals: Math.max(0, Number(v.minimum_meals) || 0),
        delivery_days: Array.isArray(v.delivery_days) ? v.delivery_days : (v.delivery_days ? [v.delivery_days] : []),
        items: itemsByVendor.get(v.id) ?? []
    }));

    report.menu = {
        step: 'success',
        vendors_count: vendorsPayload.length,
        menu_items_total: (menuItems ?? []).length,
        payload_preview: {
            approved_meals_per_week: Math.max(0, Number(client.approved_meals_per_week) || 0),
            vendors: vendorsPayload.map((v: { vendor_id: string; vendor_name: string; items: unknown[] }) => ({
                vendor_id: v.vendor_id,
                vendor_name: v.vendor_name,
                items_count: v.items.length
            }))
        }
    };

    return NextResponse.json({ ok: true, report });
}
