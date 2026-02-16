import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRetellSignature } from '../_lib/verify-retell';

const LOG = '[retell:save-food-order]';

const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** Allowed keys for Food/Meal upcoming_order (per UPCOMING_ORDER_SCHEMA.md). We must never strip serviceType, caseId, notes, or mealSelections. */
function buildFoodUpcomingOrder(
    existing: Record<string, unknown> | null,
    deliveryDayOrders: Record<string, { vendorSelections: Array<{ vendorId: string; items: Record<string, number>; itemNotes?: Record<string, string> }> }>,
    options: { preserveServiceType: boolean; preserveCaseId: boolean; preserveNotes: boolean; preserveMealSelections: boolean }
): Record<string, unknown> {
    const out: Record<string, unknown> = {
        serviceType: options.preserveServiceType && existing && typeof (existing as any).serviceType === 'string'
            ? (existing as any).serviceType
            : 'Food',
        caseId: options.preserveCaseId && existing && ((existing as any).caseId != null && (existing as any).caseId !== '')
            ? (existing as any).caseId
            : null,
        notes: options.preserveNotes && existing && ((existing as any).notes != null && (existing as any).notes !== '')
            ? (existing as any).notes
            : null,
        deliveryDayOrders
    };
    if (options.preserveMealSelections && existing && (existing as any).mealSelections != null && typeof (existing as any).mealSelections === 'object') {
        out.mealSelections = (existing as any).mealSelections;
    }
    return out;
}

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const signature = request.headers.get('x-retell-signature');
    console.log(LOG, 'request received');
    if (!verifyRetellSignature(rawBody, signature)) {
        console.error(LOG, 'auth failed: invalid or missing signature');
        return NextResponse.json({ success: false, error: 'unauthorized', message: 'Invalid signature' }, { status: 401 });
    }
    let body: {
        name?: string;
        args?: {
            client_id?: string;
            delivery_day?: string;
            vendor_selections?: Array<{ vendor_id?: string; items?: Array<{ item_id?: string; quantity?: number }> }>;
        };
        call?: unknown;
    };
    try {
        body = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
        console.error(LOG, 'invalid JSON body', e);
        return NextResponse.json({ success: false, error: 'invalid_body', message: 'Invalid JSON' }, { status: 400 });
    }

    const clientId = (body.args?.client_id ?? '').trim();
    const deliveryDayRaw = (body.args?.delivery_day ?? '').trim();
    const vendorSelections = Array.isArray(body.args?.vendor_selections) ? body.args.vendor_selections : [];

    if (!clientId) {
        console.error(LOG, 'missing client_id');
        return NextResponse.json({ success: false, error: 'missing_client_id', message: 'client_id is required.' }, { status: 400 });
    }
    const deliveryDay = VALID_DAYS.includes(deliveryDayRaw as typeof VALID_DAYS[number]) ? deliveryDayRaw : null;
    if (!deliveryDay) {
        console.error(LOG, 'missing or invalid delivery_day', { delivery_day: body.args?.delivery_day });
        return NextResponse.json({
            success: false,
            error: 'invalid_delivery_day',
            message: 'delivery_day is required and must be one of: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday.'
        }, { status: 400 });
    }

    console.log(LOG, 'client_id', clientId, 'delivery_day', deliveryDay, 'vendorSelections count', vendorSelections.length);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: client, error: clientErr } = await supabase
        .from('clients')
        .select('id, approved_meals_per_week, service_type, upcoming_order')
        .eq('id', clientId)
        .single();
    if (clientErr || !client) {
        console.error(LOG, 'client not found', { clientId, error: clientErr });
        return NextResponse.json({ success: false, error: 'client_not_found', message: 'Client not found.' }, { status: 200 });
    }
    if ((client.service_type ?? '').toString() !== 'Food') {
        console.error(LOG, 'not a Food client', { clientId, service_type: client.service_type });
        return NextResponse.json({ success: false, error: 'not_food_client', message: 'This client is not a Food client.' }, { status: 200 });
    }
    const approvedMeals = Math.max(0, Number(client.approved_meals_per_week) || 0);

    const vendorIdsRequested = vendorSelections.map((v: any) => (v.vendor_id ?? '').toString()).filter(Boolean);
    const { data: vendors } = await supabase
        .from('vendors')
        .select('id, name, minimum_meals')
        .eq('service_type', 'Food')
        .eq('is_active', true)
        .in('id', vendorIdsRequested.length ? vendorIdsRequested : ['00000000-0000-0000-0000-000000000000']);
    const vendorList = (vendors ?? []).filter((v: any) => v && (v as any).id);
    const vendorMap = new Map(vendorList.map((v: any) => [v.id, { name: v.name, minimum_meals: Math.max(0, Number(v.minimum_meals) || 0) }]));

    const { data: menuItems } = await supabase.from('menu_items').select('id, value, vendor_id');
    const itemValueMap = new Map<string, number>();
    const itemVendorMap = new Map<string, string>();
    for (const m of menuItems ?? []) {
        itemValueMap.set(m.id, Math.max(1, Number(m.value) || 1));
        itemVendorMap.set(m.id, m.vendor_id ?? '');
    }

    const vendorErrors: Array<{ vendor_id: string; vendor_name: string; minimum: number; selected: number }> = [];
    let totalMeals = 0;
    const vendorSelectionsPayload: Array<{ vendorId: string; items: Record<string, number>; itemNotes?: Record<string, string> }> = [];

    for (const vs of vendorSelections) {
        const vendorId = (vs.vendor_id ?? '').toString();
        if (!vendorId) continue;
        const vendorInfo = vendorMap.get(vendorId);
        if (!vendorInfo) {
            console.error(LOG, 'invalid vendor_id not found or not Food', { vendor_id: vendorId });
            return NextResponse.json({
                success: false,
                error: 'validation_failed',
                message: `Vendor ID "${vendorId}" is not valid or not available for Food orders.`
            }, { status: 200 });
        }
        const minimum = vendorInfo.minimum_meals;
        const vendorName = vendorInfo.name;
        const itemList = Array.isArray(vs.items) ? vs.items : [];
        const items: Record<string, number> = {};
        let vendorMeals = 0;
        for (const it of itemList) {
            const itemId = (it.item_id ?? '').toString();
            const qty = Math.max(0, Number(it.quantity) || 0);
            if (!itemId || qty <= 0) continue;
            const mealVal = itemValueMap.get(itemId);
            if (mealVal == null) {
                return NextResponse.json({
                    success: false,
                    error: 'validation_failed',
                    message: `Menu item ID "${itemId}" is not valid or does not exist.`
                }, { status: 200 });
            }
            const itemVendor = itemVendorMap.get(itemId);
            if (itemVendor !== vendorId) {
                return NextResponse.json({
                    success: false,
                    error: 'validation_failed',
                    message: `Item "${itemId}" does not belong to the vendor you selected.`
                }, { status: 200 });
            }
            vendorMeals += mealVal * qty;
            items[itemId] = (items[itemId] ?? 0) + qty;
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
        console.error(LOG, 'validation_failed: vendor minimums', vendorErrors);
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
        console.error(LOG, 'validation_failed: over limit', { totalMeals, approvedMeals });
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

    const existing = (client.upcoming_order as Record<string, unknown> | null) || null;
    let deliveryDayOrders: Record<string, { vendorSelections: Array<{ vendorId: string; items: Record<string, number>; itemNotes?: Record<string, string> }> }> = {};

    if (existing && typeof (existing as any).deliveryDayOrders === 'object' && (existing as any).deliveryDayOrders !== null) {
        const ddo = (existing as any).deliveryDayOrders;
        for (const day of Object.keys(ddo)) {
            if (VALID_DAYS.includes(day as typeof VALID_DAYS[number]) && ddo[day] && Array.isArray(ddo[day].vendorSelections)) {
                deliveryDayOrders[day] = { vendorSelections: ddo[day].vendorSelections };
            }
        }
    }
    if (existing && Array.isArray((existing as any).vendorSelections) && Object.keys(deliveryDayOrders).length === 0) {
        deliveryDayOrders[deliveryDay] = { vendorSelections: (existing as any).vendorSelections };
    }
    deliveryDayOrders[deliveryDay] = { vendorSelections: vendorSelectionsPayload };

    const upcomingOrder = buildFoodUpcomingOrder(existing, deliveryDayOrders, {
        preserveServiceType: true,
        preserveCaseId: true,
        preserveNotes: true,
        preserveMealSelections: true
    });

    const { error: updateErr } = await supabase
        .from('clients')
        .update({ upcoming_order: upcomingOrder })
        .eq('id', clientId);

    if (updateErr) {
        console.error(LOG, 'database error saving order', updateErr);
        return NextResponse.json({ success: false, error: 'database_error', message: 'Failed to save order.' }, { status: 500 });
    }
    const parts = vendorSelectionsPayload.map(v => {
        const vendorName = vendorMap.get(v.vendorId)?.name ?? v.vendorId;
        const count = Object.values(v.items).reduce((a, b) => a + b, 0);
        return `${count} meals from ${vendorName}`;
    });
    console.log(LOG, 'order saved', { clientId, delivery_day: deliveryDay, totalMeals, approvedMeals });
    return NextResponse.json({
        success: true,
        message: `Food order saved successfully for ${deliveryDay}. ${parts.join(' and ')}. Total: ${totalMeals} of ${approvedMeals} approved meals per week used.`
    });
}
