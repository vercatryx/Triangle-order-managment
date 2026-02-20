import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DAY_NAME_TO_NUMBER, getFirstDeliveryDateInWeek } from '@/lib/order-dates';
import { vendorSelectionsToDeliveryDayOrders } from '@/lib/upcoming-order-converter';
import { sendSchedulingReport, sendVendorNextWeekSummary, type VendorBreakdownItem } from '@/lib/email-report';
import { getNextCreationId } from '@/lib/actions';
import * as XLSX from 'xlsx';

// Vercel limit is 800s; allow max so 800+ orders can complete (many sequential DB round-trips per order)
export const maxDuration = 800;

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Get date for a given day name within a week that starts on Sunday. */
function getDateForDayInWeek(weekStart: Date, dayName: string): Date | null {
    const n = DAY_NAME_TO_NUMBER[dayName];
    if (n === undefined) return null;
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + n);
    return d;
}

export async function POST(request: NextRequest) {
    const report = {
        totalCreated: 0,
        breakdown: { Food: 0, Meal: 0, Boxes: 0, Custom: 0 },
        unexpectedFailures: [] as { clientName: string; orderType: string; date: string; reason: string }[]
    };

    type DiagnosticEntry = {
        clientId: string;
        clientName: string;
        vendorId: string;
        vendorName: string;
        date: string;
        orderType: string;
        outcome: 'created' | 'skipped' | 'failed';
        orderId?: string;
        reason?: string;
    };
    const diagnostics: DiagnosticEntry[] = [];

    type ClientReportRow = { clientId: string; clientName: string; ordersCreated: number; reason: string; vendors: Set<string>; types: Set<string> };
    const clientReportMap = new Map<string, ClientReportRow>();

    let batchMode: { batchIndex: number; batchSize: number; creationId?: number } | null = null;
    let totalClientsCount: number | null = null;
    /** When set, only process these client IDs (for "Create by Name" feature). Excludes dependants implicitly. */
    let clientIdsFilter: string[] | null = null;
    try {
        const body = await request.json().catch(() => ({}));
        const batchIndex = typeof body.batchIndex === 'number' ? body.batchIndex : -1;
        const batchSize = typeof body.batchSize === 'number' && body.batchSize > 0 ? Math.min(body.batchSize, 500) : 0;
        if (batchIndex >= 0 && batchSize > 0) {
            batchMode = { batchIndex, batchSize, creationId: typeof body.creationId === 'number' ? body.creationId : undefined };
        }
        const ids = body.clientIds;
        if (Array.isArray(ids) && ids.length > 0 && ids.every((x: unknown) => typeof x === 'string')) {
            clientIdsFilter = ids as string[];
        } else if (typeof body.clientId === 'string' && body.clientId.trim()) {
            clientIdsFilter = [body.clientId.trim()];
        }
    } catch {
        // ignore
    }

    try {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const dayOfWeek = today.getDay();
        const daysUntilNextSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
        const nextWeekStart = new Date(today);
        nextWeekStart.setDate(today.getDate() + daysUntilNextSunday);
        const nextWeekEnd = new Date(nextWeekStart);
        nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
        nextWeekEnd.setHours(23, 59, 59, 999);

        const weekStartStr = nextWeekStart.toISOString().split('T')[0];
        const weekEndStr = nextWeekEnd.toISOString().split('T')[0];

        const [
            vendorsRes,
            statusesRes,
            menuItemsRes,
            mealItemsRes,
            boxTypesRes,
            settingsRes
        ] = await Promise.all([
            supabase.from('vendors').select('id, name, email, service_type, delivery_days, delivery_frequency, is_active, minimum_meals, cutoff_hours'),
            supabase.from('client_statuses').select('id, name, is_system_default, deliveries_allowed'),
            supabase.from('menu_items').select('id, vendor_id, name, value, price_each, is_active, category_id, minimum_order, image_url, sort_order'),
            supabase.from('breakfast_items').select('id, category_id, name, quota_value, price_each, is_active, vendor_id, image_url, sort_order'),
            supabase.from('box_types').select('id, name'),
            supabase.from('app_settings').select('report_email, send_vendor_next_week_emails').single()
        ]);

        let clients: any[] = [];
        if (clientIdsFilter && clientIdsFilter.length > 0) {
            // Single-client or name-search mode: load only specified IDs (primary clients only)
            const { data: pageData, error: clientsError } = await supabase
                .from('clients')
                .select('id, full_name, status_id, service_type, parent_client_id, expiration_date, upcoming_order')
                .in('id', clientIdsFilter)
                .is('parent_client_id', null);
            if (clientsError) {
                console.error('[Create Orders Next Week] Error fetching filtered clients:', clientsError);
                throw clientsError;
            }
            clients = pageData ?? [];
            console.log(`[Create Orders Next Week] Loaded ${clients.length} client(s) by IDs: ${clientIdsFilter.join(', ')}`);
        } else if (batchMode) {
            const { batchIndex, batchSize: size } = batchMode;
            const from = batchIndex * size;
            const to = from + size - 1;
            const { count } = await supabase.from('clients').select('*', { count: 'exact', head: true }).is('parent_client_id', null);
            totalClientsCount = count ?? 0;
            const { data: pageData, error: clientsError } = await supabase
                .from('clients')
                .select('id, full_name, status_id, service_type, parent_client_id, expiration_date, upcoming_order')
                .is('parent_client_id', null)
                .order('id', { ascending: true })
                .range(from, to);
            if (clientsError) {
                console.error('[Create Orders Next Week] Error fetching client batch:', clientsError);
                throw clientsError;
            }
            clients = pageData ?? [];
            console.log(`[Create Orders Next Week] Batch ${batchIndex}: loaded ${clients.length} clients (range ${from}-${to})`);
        } else {
            const clientPageSize = 1000;
            let clientPage = 0;
            while (true) {
                const { data: pageData, error: clientsError } = await supabase
                    .from('clients')
                    .select('id, full_name, status_id, service_type, parent_client_id, expiration_date, upcoming_order')
                    .is('parent_client_id', null)
                    .order('id', { ascending: true })
                    .range(clientPage * clientPageSize, (clientPage + 1) * clientPageSize - 1);
                if (clientsError) {
                    console.error('[Create Orders Next Week] Error fetching clients:', clientsError);
                    throw clientsError;
                }
                if (!pageData || pageData.length === 0) break;
                clients.push(...pageData);
                if (pageData.length < clientPageSize) break;
                clientPage++;
            }
            console.log(`[Create Orders Next Week] Loaded ${clients.length} clients (week ${weekStartStr} to ${weekEndStr})`);
        }

        const allVendors = (vendorsRes.data || []).map((v: any) => ({
            id: v.id,
            name: v.name,
            email: v.email || '',
            deliveryDays: v.delivery_days || [],
            cutoffDays: v.cutoff_hours ?? 0
        }));
        const allStatuses = (statusesRes.data || []).map((s: any) => ({
            id: s.id,
            name: s.name,
            deliveriesAllowed: s.deliveries_allowed
        }));
        const allMenuItems = menuItemsRes.data || [];
        const allMealItems = (mealItemsRes.data || []).map((i: any) => ({ ...i, itemType: 'meal' as const }));
        const allBoxTypes = boxTypesRes.data || [];

        // At start: know which vendors are active. We only skip creating an order for a given vendor if that vendor is inactive (no client-level blocking).
        const vendorActiveMap = new Map<string, boolean>();
        for (const v of vendorsRes.data || []) {
            vendorActiveMap.set(v.id, !!v.is_active);
        }

        // Derive food/meal/box/custom from clients.upcoming_order only (single source of truth per UPCOMING_ORDER_SCHEMA)
        // Support both camelCase (UI) and snake_case (DB/legacy) so no clients are missed (e.g. JOEL SCHLESINGER).
        // Type is determined by upcoming_order.serviceType / service_type, not clients.service_type.
        // Food: serviceType 'Food' (or legacy missing), with deliveryDayOrders or vendorSelections
        const foodOrders: { client_id: string; delivery_day_orders: Record<string, { vendorSelections?: any[] }>; notes: string | null; case_id: string | null }[] = [];
        let foodSkippedNoData = 0;
        for (const c of clients || []) {
            const uo = c.upcoming_order;
            if (!uo || typeof uo !== 'object') continue;
            const st = (uo as any).serviceType ?? (uo as any).service_type;
            const isFoodType = st === 'Food' || st === undefined;
            if (!isFoodType) continue;

            let delivery_day_orders: Record<string, { vendorSelections?: any[] }> | null = null;
            const ddo = (uo as any).deliveryDayOrders ?? (uo as any).delivery_day_orders;
            const vsel = (uo as any).vendorSelections ?? (uo as any).vendor_selections;

            if (ddo && typeof ddo === 'object' && Object.keys(ddo).length > 0) {
                delivery_day_orders = ddo;
            } else if (Array.isArray(vsel) && vsel.length > 0) {
                const normalized = vsel.map((vs: any) => ({ ...vs, vendorId: vs.vendorId ?? vs.vendor_id }));
                const converted = vendorSelectionsToDeliveryDayOrders(normalized);
                if (Object.keys(converted).length > 0) delivery_day_orders = converted;
            }
            if (!delivery_day_orders || Object.keys(delivery_day_orders).length === 0) {
                foodSkippedNoData++;
                continue;
            }

            foodOrders.push({
                client_id: c.id,
                delivery_day_orders,
                notes: (uo as any).notes ?? null,
                case_id: (uo as any).caseId ?? (uo as any).case_id ?? null
            });
        }
        // Meal: serviceType 'Food' or 'Meal' with mealSelections (schema allows both in same payload)
        const mealOrders = (clients || [])
            .filter((c: any) => {
                const uo = c.upcoming_order;
                if (!uo || typeof uo !== 'object') return false;
                const mealSel = (uo as any).mealSelections ?? (uo as any).meal_selections;
                if (!mealSel || typeof mealSel !== 'object' || Object.keys(mealSel).length === 0) return false;
                const st = (uo as any).serviceType ?? (uo as any).service_type;
                return st === 'Food' || st === 'Meal';
            })
            .map((c: any) => ({
                client_id: c.id,
                meal_selections: (c.upcoming_order as any).mealSelections ?? (c.upcoming_order as any).meal_selections,
                notes: (c.upcoming_order as any).notes ?? null,
                case_id: (c.upcoming_order as any).caseId ?? (c.upcoming_order as any).case_id ?? null
            }));
        // Boxes: serviceType 'Boxes' with boxOrders (support snake_case)
        const boxOrders: { client_id: string; box_type_id?: string; vendor_id?: string; quantity: number; items: any; item_notes?: any; case_id?: string; notes?: string }[] = [];
        for (const c of clients || []) {
            const uo = c.upcoming_order;
            if (!uo || typeof uo !== 'object') continue;
            const st = (uo as any).serviceType ?? (uo as any).service_type;
            const boxList = (uo as any).boxOrders ?? (uo as any).box_orders;
            if (st !== 'Boxes' || !Array.isArray(boxList) || boxList.length === 0) continue;
            for (const b of boxList) {
                boxOrders.push({
                    client_id: c.id,
                    box_type_id: b.boxTypeId ?? b.box_type_id ?? undefined,
                    vendor_id: b.vendorId ?? b.vendor_id ?? undefined,
                    quantity: b.quantity ?? 1,
                    items: b.items ?? {},
                    item_notes: b.itemNotes ?? b.item_notes,
                    case_id: (uo as any).caseId ?? (uo as any).case_id ?? undefined,
                    notes: (uo as any).notes
                });
            }
        }
        // Custom orders from clients.upcoming_order (single source of truth, support snake_case)
        const customOrders = (clients || [])
            .filter((c: any) => {
                const uo = c.upcoming_order;
                if (!uo || typeof uo !== 'object') return false;
                const st = (uo as any).serviceType ?? (uo as any).service_type;
                return st === 'Custom';
            })
            .map((c: any) => ({
                client_id: c.id,
                id: c.id,
                delivery_day: (c.upcoming_order as any)?.deliveryDay ?? (c.upcoming_order as any)?.delivery_day,
                total_value: (c.upcoming_order as any)?.custom_price ?? (c.upcoming_order as any)?.totalValue ?? 0,
                notes: (c.upcoming_order as any)?.notes ?? null,
                case_id: (c.upcoming_order as any)?.caseId ?? (c.upcoming_order as any)?.case_id ?? null,
                custom_name: (c.upcoming_order as any)?.custom_name,
                vendorId: (c.upcoming_order as any)?.vendorId ?? (c.upcoming_order as any)?.vendor_id,
                upcoming_order: c.upcoming_order
            }))
            .filter((co: any) => co.delivery_day);

        console.log(`[Create Orders Next Week] Work to do: foodOrders=${foodOrders.length} mealOrders=${mealOrders.length} boxOrders=${boxOrders.length} customOrders=${customOrders.length}`);
        if (foodSkippedNoData > 0) {
            console.log(`[Create Orders Next Week] Food skipped (no delivery data): ${foodSkippedNoData}`);
        }

        const reportEmail = (settingsRes.data as any)?.report_email || '';
        const sendVendorNextWeekEmails = (settingsRes.data as any)?.send_vendor_next_week_emails !== false;

        const vendorMap = new Map(allVendors.map((v: any) => [v.id, v]));
        const statusMap = new Map(allStatuses.map((s: any) => [s.id, s]));
        const clientMap = new Map(clients.map((c: any) => [c.id, c]));
        const menuItemMap = new Map(allMenuItems.map((i: any) => [i.id, i]));
        const mealItemMap = new Map(allMealItems.map((i: any) => [i.id, i]));

        const todayStr = today.toISOString().split('T')[0];
        function isClientEligible(clientId: string): { ok: boolean; reason?: string } {
            const client = clientMap.get(clientId);
            if (!client) return { ok: false, reason: 'Client not found' };
            const status = statusMap.get(client.status_id);
            if (!status?.deliveriesAllowed) return { ok: false, reason: `Status "${status?.name || 'Unknown'}" does not allow deliveries` };
            if (client.expiration_date) {
                const exp = new Date(client.expiration_date);
                exp.setHours(0, 0, 0, 0);
                if (exp < today) return { ok: false, reason: 'Expiration date has passed' };
            }
            return { ok: true };
        }

        for (const c of clients) {
            clientReportMap.set(c.id, {
                clientId: c.id,
                clientName: c.full_name,
                ordersCreated: 0,
                reason: '',
                vendors: new Set(),
                types: new Set()
            });
        }

        function recordReportOrder(clientId: string, vendorId: string, serviceType: string) {
            const row = clientReportMap.get(clientId);
            if (!row) return;
            const vendor = vendorMap.get(vendorId);
            if (vendor?.name) row.vendors.add(vendor.name);
            row.types.add(serviceType);
        }

        const { data: maxOrderData } = await supabase.from('orders').select('order_number').order('order_number', { ascending: false }).limit(1).maybeSingle();
        let nextOrderNumber = Math.max(100000, (maxOrderData?.order_number || 0) + 1);
        const creationId = batchMode && batchMode.batchIndex > 0 && batchMode.creationId != null
            ? batchMode.creationId
            : await getNextCreationId();

        // Track orders by vendor and day for vendor emails and admin report
        const vendorOrdersByDay: Record<string, Record<string, number>> = {};
        function recordVendorOrder(vendorId: string, deliveryDateStr: string) {
            if (!vendorOrdersByDay[vendorId]) vendorOrdersByDay[vendorId] = {};
            vendorOrdersByDay[vendorId][deliveryDateStr] = (vendorOrdersByDay[vendorId][deliveryDateStr] || 0) + 1;
        }

        const logInterval = 100;
        async function createOrder(
            clientId: string,
            serviceType: 'Food' | 'Meal' | 'Boxes' | 'Custom',
            deliveryDate: Date,
            totalValue: number,
            totalItems: number,
            notes: string | null,
            caseId: string | undefined,
            assignedOrderNumber: number,
            clientName?: string
        ): Promise<any> {
            const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
            try {
                const { data: newOrder, error: orderErr } = await supabase
                    .from('orders')
                    .insert({
                        client_id: clientId,
                        service_type: serviceType,
                        status: 'scheduled',
                        scheduled_delivery_date: deliveryDateStr,
                        total_value: totalValue,
                        total_items: totalItems,
                        order_number: assignedOrderNumber,
                        last_updated: now.toISOString(),
                        notes,
                        case_id: caseId || `CASE-${Date.now()}`,
                        creation_id: creationId
                    })
                    .select()
                    .single();
                if (orderErr) throw orderErr;
                report.totalCreated++;
                if (serviceType === 'Food') report.breakdown.Food++;
                else if (serviceType === 'Meal') report.breakdown.Meal++;
                else if (serviceType === 'Boxes') report.breakdown.Boxes++;
                else report.breakdown.Custom++;
                const row = clientReportMap.get(clientId);
                if (row) row.ordersCreated++;
                if (report.totalCreated % logInterval === 0) {
                    console.log(`[Create Orders Next Week] Progress: totalCreated=${report.totalCreated}`);
                }
                return newOrder;
            } catch (err: any) {
                report.unexpectedFailures.push({
                    clientName: clientName ?? clientId,
                    orderType: serviceType,
                    date: deliveryDateStr,
                    reason: err?.message || String(err)
                });
                console.error(`[Create Orders Next Week] Failed to create order for client ${clientId} (${serviceType} ${deliveryDateStr}):`, err?.message || err);
                return null;
            }
        }

        async function orderExists(clientId: string, deliveryDateStr: string, serviceType: string, vendorId?: string): Promise<boolean> {
            const { data: existing } = await supabase
                .from('orders')
                .select('id')
                .eq('client_id', clientId)
                .eq('scheduled_delivery_date', deliveryDateStr)
                .eq('service_type', serviceType)
                .limit(1)
                .maybeSingle();
            if (!existing) return false;
            if (vendorId) {
                const { count } = await supabase
                    .from('order_vendor_selections')
                    .select('*', { count: 'exact', head: true })
                    .eq('order_id', existing.id)
                    .eq('vendor_id', vendorId);
                return (count ?? 0) > 0;
            }
            return true;
        }

        for (const fo of foodOrders) {
            const eligible = isClientEligible(fo.client_id);
            if (!eligible.ok) {
                const row = clientReportMap.get(fo.client_id);
                if (row && !row.reason) row.reason = eligible.reason || 'Not eligible';
                continue;
            }

            const dayOrders = typeof fo.delivery_day_orders === 'string' ? JSON.parse(fo.delivery_day_orders) : fo.delivery_day_orders;
            if (!dayOrders) continue;

            for (const dayName of Object.keys(dayOrders)) {
                const deliveryDate = getDateForDayInWeek(nextWeekStart, dayName);
                if (!deliveryDate) continue;
                const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
                if (deliveryDateStr < weekStartStr || deliveryDateStr > weekEndStr) continue;

                const vendorSelections = dayOrders[dayName].vendorSelections || [];
                for (const sel of vendorSelections) {
                    if (!sel.vendorId) continue;
                    const vendor = vendorMap.get(sel.vendorId);
                    if (!vendor) continue;
                    if (vendorActiveMap.get(sel.vendorId) === false) continue; // skip inactive vendor only
                    const clientName = clientMap.get(fo.client_id)?.full_name ?? fo.client_id;

                    if (await orderExists(fo.client_id, deliveryDateStr, 'Food', sel.vendorId)) {
                        diagnostics.push({ clientId: fo.client_id, clientName, vendorId: sel.vendorId, vendorName: vendor.name, date: deliveryDateStr, orderType: 'Food', outcome: 'skipped', reason: 'Order already exists for this client/date/vendor' });
                        continue;
                    }

                    let valueTotal = 0;
                    const itemsList: { menu_item_id: string; quantity: number; unit_value: number; total_value: number; notes: string | null }[] = [];
                    if (sel.items) {
                        for (const [itemId, qty] of Object.entries(sel.items)) {
                            const q = Number(qty);
                            if (q <= 0) continue;
                            const mItem = menuItemMap.get(itemId) || mealItemMap.get(itemId);
                            if (!mItem) continue;
                            const price = (mItem as any).itemType === 'meal' ? (mItem.price_each ?? 0) : (mItem.price_each ?? mItem.value ?? 0);
                            valueTotal += price * q;
                            itemsList.push({
                                menu_item_id: itemId,
                                quantity: q,
                                unit_value: price,
                                total_value: price * q,
                                notes: (sel.itemNotes as Record<string, string>)?.[itemId] || null
                            });
                        }
                    }
                    if (itemsList.length === 0) {
                        diagnostics.push({ clientId: fo.client_id, clientName, vendorId: sel.vendorId, vendorName: vendor.name, date: deliveryDateStr, orderType: 'Food', outcome: 'skipped', reason: 'No valid items in selection' });
                        continue;
                    }

                    const assignedId = nextOrderNumber++;
                    const newOrder = await createOrder(
                        fo.client_id,
                        'Food',
                        deliveryDate,
                        valueTotal,
                        itemsList.reduce((s, i) => s + i.quantity, 0),
                        (fo as any).notes || null,
                        fo.case_id ?? undefined,
                        assignedId,
                        clientName
                    );
                    if (!newOrder) {
                        diagnostics.push({ clientId: fo.client_id, clientName, vendorId: sel.vendorId, vendorName: vendor.name, date: deliveryDateStr, orderType: 'Food', outcome: 'failed', reason: report.unexpectedFailures[report.unexpectedFailures.length - 1]?.reason ?? 'createOrder failed' });
                        continue;
                    }

                    const { data: vs } = await supabase.from('order_vendor_selections').insert({ order_id: newOrder.id, vendor_id: sel.vendorId }).select().single();
                    if (vs) {
                        recordVendorOrder(sel.vendorId, deliveryDateStr);
                        recordReportOrder(fo.client_id, sel.vendorId, 'Food');
                        await supabase.from('order_items').insert(itemsList.map(i => ({ ...i, vendor_selection_id: vs.id, order_id: newOrder.id })));
                        diagnostics.push({ clientId: fo.client_id, clientName, vendorId: sel.vendorId, vendorName: vendor.name, date: deliveryDateStr, orderType: 'Food', outcome: 'created', orderId: newOrder.id });
                    } else {
                        diagnostics.push({ clientId: fo.client_id, clientName, vendorId: sel.vendorId, vendorName: vendor.name, date: deliveryDateStr, orderType: 'Food', outcome: 'failed', orderId: newOrder.id, reason: 'order_vendor_selections insert failed' });
                    }
                }
            }
        }
        console.log(`[Create Orders Next Week] Food phase done. totalCreated=${report.totalCreated}`);

        for (const mo of mealOrders) {
            const eligible = isClientEligible(mo.client_id);
            if (!eligible.ok) {
                const row = clientReportMap.get(mo.client_id);
                if (row && !row.reason) row.reason = eligible.reason || 'Not eligible';
                continue;
            }

            const rawSelections = typeof mo.meal_selections === 'string' ? JSON.parse(mo.meal_selections) : mo.meal_selections;
            if (!rawSelections) continue;

            // Pre-check: for each (date, vendor) we would create, see if an order already exists. Skip only those; then create all meal-type orders without checking again.
            const skipDateVendor = new Set<string>();
            for (const [_mt, group] of Object.entries(rawSelections)) {
                const g = group as { vendorId?: string; vendor_id?: string };
                const mealVendorId = g?.vendorId ?? g?.vendor_id;
                if (!mealVendorId) continue;
                const vendor = vendorMap.get(mealVendorId);
                if (!vendor) continue;
                if (vendorActiveMap.get(mealVendorId) === false) continue;
                const deliveryDate = getFirstDeliveryDateInWeek(nextWeekStart, vendor.deliveryDays);
                if (!deliveryDate) continue;
                const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
                if (deliveryDateStr < weekStartStr || deliveryDateStr > weekEndStr) continue;
                const key = `${deliveryDateStr}|${mealVendorId}`;
                if (skipDateVendor.has(key)) continue;
                if (await orderExists(mo.client_id, deliveryDateStr, 'Meal', mealVendorId)) {
                    skipDateVendor.add(key);
                    const clientName = clientMap.get(mo.client_id)?.full_name ?? mo.client_id;
                    diagnostics.push({ clientId: mo.client_id, clientName, vendorId: mealVendorId, vendorName: vendor.name, date: deliveryDateStr, orderType: 'Meal', outcome: 'skipped', reason: 'Order already exists for this client/date/vendor' });
                }
            }

            const clientName = clientMap.get(mo.client_id)?.full_name ?? mo.client_id;
            for (const [_mealType, group] of Object.entries(rawSelections)) {
                const g = group as { vendorId?: string; vendor_id?: string; items?: Record<string, number>; itemNotes?: Record<string, string> };
                const mealVendorId = g?.vendorId ?? g?.vendor_id;
                if (!mealVendorId) continue;
                const vendor = vendorMap.get(mealVendorId);
                if (!vendor) continue;
                if (vendorActiveMap.get(mealVendorId) === false) continue;

                const deliveryDate = getFirstDeliveryDateInWeek(nextWeekStart, vendor.deliveryDays);
                if (!deliveryDate) continue;
                const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
                if (deliveryDateStr < weekStartStr || deliveryDateStr > weekEndStr) continue;
                if (skipDateVendor.has(`${deliveryDateStr}|${mealVendorId}`)) continue;

                let orderTotalValue = 0;
                let orderTotalItems = 0;
                const itemsList: { menu_item_id: string; quantity: number; unit_value: number; total_value: number; notes: string | null }[] = [];
                if (g.items) {
                    for (const [itemId, qty] of Object.entries(g.items)) {
                        const q = Number(qty);
                        if (q <= 0) continue;
                        const mItem = allMealItems.find((i: any) => i.id === itemId) || allMenuItems.find((i: any) => i.id === itemId);
                        const price = mItem ? ((mItem as any).itemType === 'meal' ? (mItem.price_each ?? 0) : (mItem.price_each ?? mItem.value ?? 0)) : 0;
                        orderTotalValue += price * q;
                        orderTotalItems += q;
                        itemsList.push({
                            menu_item_id: itemId,
                            quantity: q,
                            unit_value: price,
                            total_value: price * q,
                            notes: g.itemNotes?.[itemId] || null
                        });
                    }
                }
                if (itemsList.length === 0) continue;

                const assignedId = nextOrderNumber++;
                const newOrder = await createOrder(
                    mo.client_id,
                    'Meal',
                    deliveryDate,
                    orderTotalValue,
                    orderTotalItems,
                    (mo as any).notes || null,
                    mo.case_id,
                    assignedId,
                    clientName
                );
                if (!newOrder) {
                    diagnostics.push({ clientId: mo.client_id, clientName, vendorId: mealVendorId, vendorName: vendor.name, date: deliveryDateStr, orderType: 'Meal', outcome: 'failed', reason: report.unexpectedFailures[report.unexpectedFailures.length - 1]?.reason ?? 'createOrder failed' });
                    continue;
                }

                const { data: vs } = await supabase.from('order_vendor_selections').insert({ order_id: newOrder.id, vendor_id: mealVendorId }).select().single();
                if (vs) {
                    recordVendorOrder(mealVendorId, deliveryDateStr);
                    recordReportOrder(mo.client_id, mealVendorId, 'Meal');
                    await supabase.from('order_items').insert(itemsList.map(i => ({ ...i, vendor_selection_id: vs.id, order_id: newOrder.id })));
                    diagnostics.push({ clientId: mo.client_id, clientName, vendorId: mealVendorId, vendorName: vendor.name, date: deliveryDateStr, orderType: 'Meal', outcome: 'created', orderId: newOrder.id });
                } else {
                    diagnostics.push({ clientId: mo.client_id, clientName, vendorId: mealVendorId, vendorName: vendor.name, date: deliveryDateStr, orderType: 'Meal', outcome: 'failed', orderId: newOrder.id, reason: 'order_vendor_selections insert failed' });
                }
            }
        }
        console.log(`[Create Orders Next Week] Meal phase done. totalCreated=${report.totalCreated}`);

        // Group box orders by client so we create one combined Boxes order per client per week
        const boxOrdersByClient = new Map<string, typeof boxOrders>();
        for (const bo of boxOrders) {
            const list = boxOrdersByClient.get(bo.client_id) || [];
            list.push(bo);
            boxOrdersByClient.set(bo.client_id, list);
        }

        function computeBoxValue(bo: any): number {
            let boxValue = 0;
            const boxItems = typeof bo.items === 'string' ? JSON.parse(bo.items) : bo.items;
            if (boxItems) {
                for (const [id, qty] of Object.entries(boxItems)) {
                    const m = allMenuItems.find((x: any) => x.id === id) || allMealItems.find((x: any) => x.id === id);
                    if (m) boxValue += (m.price_each ?? m.value ?? 0) * Number(qty);
                }
            }
            return boxValue;
        }

        for (const [clientId, clientBoxOrders] of boxOrdersByClient) {
            const eligible = isClientEligible(clientId);
            if (!eligible.ok) {
                const row = clientReportMap.get(clientId);
                if (row && !row.reason) row.reason = eligible.reason || 'Not eligible';
                continue;
            }

            const hasNoVendor = clientBoxOrders.some((bo: any) => !bo.vendor_id);
            if (hasNoVendor) {
                const row = clientReportMap.get(clientId);
                if (row && !row.reason) row.reason = 'No vendor set for box order';
                continue;
            }

            // Earliest delivery date in the week among all box vendors
            let earliestDelivery: Date | null = null;
            for (const bo of clientBoxOrders) {
                const vendor = vendorMap.get(bo.vendor_id);
                if (!vendor) continue;
                const d = getFirstDeliveryDateInWeek(nextWeekStart, vendor.deliveryDays);
                if (d && (!earliestDelivery || d < earliestDelivery)) earliestDelivery = d;
            }
            if (!earliestDelivery) continue;
            const deliveryDateStr = earliestDelivery.toISOString().split('T')[0];
            if (deliveryDateStr < weekStartStr || deliveryDateStr > weekEndStr) continue;

            const { count } = await supabase
                .from('orders')
                .select('*', { count: 'exact', head: true })
                .eq('client_id', clientId)
                .eq('service_type', 'Boxes')
                .gte('scheduled_delivery_date', weekStartStr)
                .lte('scheduled_delivery_date', weekEndStr);
            if ((count ?? 0) >= 1) continue;

            let totalOrderValue = 0;
            let totalBoxCount = 0;
            const selectionsToInsert: { vendor_id: string; box_type_id: string | null; quantity: number; unit_value: number; total_value: number; items: any; item_notes?: any }[] = [];
            for (const bo of clientBoxOrders) {
                if (!bo.vendor_id) continue;
                const vendor = vendorMap.get(bo.vendor_id);
                if (!vendor) continue;
                if (vendorActiveMap.get(bo.vendor_id) === false) continue; // skip inactive vendor only
                const boxValue = computeBoxValue(bo);
                const qty = bo.quantity || 1;
                const totalBoxValue = boxValue * qty;
                totalOrderValue += totalBoxValue;
                totalBoxCount += qty;
                const boxTypeId = bo.box_type_id && bo.box_type_id !== '' ? bo.box_type_id : null;
                selectionsToInsert.push({
                    vendor_id: bo.vendor_id,
                    box_type_id: boxTypeId,
                    quantity: qty,
                    unit_value: boxValue,
                    total_value: totalBoxValue,
                    items: bo.items,
                    item_notes: bo.item_notes ?? {}
                });
            }
            if (selectionsToInsert.length === 0) continue;

            const firstBo = clientBoxOrders[0];
            const assignedId = nextOrderNumber++;
            const newOrder = await createOrder(
                clientId,
                'Boxes',
                earliestDelivery,
                totalOrderValue,
                totalBoxCount,
                (firstBo as any).notes || null,
                firstBo.case_id,
                assignedId,
                clientMap.get(clientId)?.full_name
            );
            if (!newOrder) {
                const clientName = clientMap.get(clientId)?.full_name ?? clientId;
                for (const vid of [...new Set(selectionsToInsert.map(s => s.vendor_id))]) {
                    const v = vendorMap.get(vid);
                    diagnostics.push({ clientId, clientName, vendorId: vid, vendorName: v?.name ?? vid, date: deliveryDateStr, orderType: 'Boxes', outcome: 'failed', reason: report.unexpectedFailures[report.unexpectedFailures.length - 1]?.reason ?? 'createOrder failed' });
                }
                continue;
            }

            // Count each vendor once per order (one Box order can have multiple box lines for same vendor)
            const vendorIdsInOrder = [...new Set(selectionsToInsert.map(s => s.vendor_id))];
            for (const vid of vendorIdsInOrder) {
                recordVendorOrder(vid, deliveryDateStr);
                recordReportOrder(clientId, vid, 'Boxes');
                const v = vendorMap.get(vid);
                diagnostics.push({ clientId, clientName: clientMap.get(clientId)?.full_name ?? clientId, vendorId: vid, vendorName: v?.name ?? vid, date: deliveryDateStr, orderType: 'Boxes', outcome: 'created', orderId: newOrder.id });
            }
            for (const sel of selectionsToInsert) {
                await supabase.from('order_box_selections').insert({
                    order_id: newOrder.id,
                    vendor_id: sel.vendor_id,
                    box_type_id: sel.box_type_id,
                    quantity: sel.quantity,
                    unit_value: sel.unit_value,
                    total_value: sel.total_value,
                    items: sel.items,
                    item_notes: sel.item_notes ?? {}
                });
            }
        }
        console.log(`[Create Orders Next Week] Boxes phase done. totalCreated=${report.totalCreated}`);

        if (customOrders.length > 0) {
            for (const co of customOrders) {
                const eligible = isClientEligible(co.client_id);
                if (!eligible.ok) {
                    const row = clientReportMap.get(co.client_id);
                    if (row && !row.reason) row.reason = eligible.reason || 'Not eligible';
                    continue;
                }
                if (!co.delivery_day) continue;

                const vendorId = co.vendorId ?? co.upcoming_order?.vendorId;
                if (!vendorId) continue;
                if (vendorActiveMap.get(vendorId) === false) continue; // skip inactive vendor only

                const deliveryDate = getDateForDayInWeek(nextWeekStart, co.delivery_day);
                if (!deliveryDate) continue;
                const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
                if (deliveryDateStr < weekStartStr || deliveryDateStr > weekEndStr) continue;

                const vendor = vendorMap.get(vendorId);
                const clientName = clientMap.get(co.client_id)?.full_name ?? co.client_id;
                if (await orderExists(co.client_id, deliveryDateStr, 'Custom', vendorId)) {
                    diagnostics.push({ clientId: co.client_id, clientName, vendorId, vendorName: vendor?.name ?? vendorId, date: deliveryDateStr, orderType: 'Custom', outcome: 'skipped', reason: 'Order already exists for this client/date/vendor' });
                    continue;
                }

                const totalValue = Number(co.total_value) || 0;
                const rawName = co.custom_name || co.upcoming_order?.custom_name || 'Custom Item';
                const itemNames = rawName.split(',').map((s: string) => s.trim()).filter(Boolean);
                const names = itemNames.length >= 1 ? itemNames : ['Custom Item'];
                const itemCount = names.length;
                const valuePerItem = totalValue / itemCount;

                const assignedId = nextOrderNumber++;
                const newOrder = await createOrder(
                    co.client_id,
                    'Custom',
                    deliveryDate,
                    totalValue,
                    itemCount,
                    co.notes || null,
                    co.case_id,
                    assignedId,
                    clientName
                );
                if (!newOrder) {
                    diagnostics.push({ clientId: co.client_id, clientName, vendorId, vendorName: vendor?.name ?? vendorId, date: deliveryDateStr, orderType: 'Custom', outcome: 'failed', reason: report.unexpectedFailures[report.unexpectedFailures.length - 1]?.reason ?? 'createOrder failed' });
                    continue;
                }

                const { data: newVs } = await supabase.from('order_vendor_selections').insert({ order_id: newOrder.id, vendor_id: vendorId }).select().single();
                if (newVs) {
                    recordVendorOrder(vendorId, deliveryDateStr);
                    recordReportOrder(co.client_id, vendorId, 'Custom');
                    const itemsToInsert = names.map((name: string, i: number) => {
                        // Put rounding remainder on last item so total sums exactly
                        const isLast = i === names.length - 1;
                        const unitVal = isLast ? totalValue - valuePerItem * (names.length - 1) : valuePerItem;
                        return {
                            order_id: newOrder.id,
                            vendor_selection_id: newVs.id,
                            menu_item_id: null,
                            custom_name: name,
                            custom_price: unitVal,
                            quantity: 1,
                            unit_value: unitVal,
                            total_value: unitVal,
                            notes: i === 0 ? co.notes : null
                        };
                    });
                    await supabase.from('order_items').insert(itemsToInsert);
                    diagnostics.push({ clientId: co.client_id, clientName, vendorId, vendorName: vendor?.name ?? vendorId, date: deliveryDateStr, orderType: 'Custom', outcome: 'created', orderId: newOrder.id });
                } else {
                    diagnostics.push({ clientId: co.client_id, clientName, vendorId, vendorName: vendor?.name ?? vendorId, date: deliveryDateStr, orderType: 'Custom', outcome: 'failed', orderId: newOrder.id, reason: 'order_vendor_selections insert failed' });
                }
            }
        }
        console.log(`[Create Orders Next Week] Custom phase done. totalCreated=${report.totalCreated}`);

        for (const row of clientReportMap.values()) {
            if (row.ordersCreated === 0 && !row.reason) {
                const client = clientMap.get(row.clientId);
                const uo = client?.upcoming_order;
                const st = uo && typeof uo === 'object' ? ((uo as any).serviceType ?? (uo as any).service_type) : undefined;
                if (st === 'Food') row.reason = 'No upcoming food orders';
                else if (st === 'Meal') row.reason = 'No upcoming meal orders';
                else if (st === 'Boxes') row.reason = 'No upcoming box orders';
                else if (st === 'Custom') row.reason = 'No upcoming custom orders';
                else row.reason = 'No upcoming orders';
            }
        }

        const excelData = Array.from(clientReportMap.values()).map(row => ({
            'Client ID': row.clientId,
            'Client Name': row.clientName,
            'Orders Created': row.ordersCreated,
            'Vendor(s)': Array.from(row.vendors).sort().join(', ') || '-',
            'Type(s)': Array.from(row.types).sort().join(', ') || '-',
            'Reason (if no orders)': row.reason || '-'
        }));

        // Build vendor breakdown for admin report and vendor emails
        const vendorBreakdown: VendorBreakdownItem[] = [];
        for (const vendorId of Object.keys(vendorOrdersByDay)) {
            const byDay = vendorOrdersByDay[vendorId];
            const total = Object.values(byDay).reduce((s, n) => s + n, 0);
            if (total === 0) continue;
            const vendor = vendorMap.get(vendorId) as { id: string; name: string; email?: string } | undefined;
            vendorBreakdown.push({
                vendorId,
                vendorName: vendor?.name || vendorId,
                byDay,
                total
            });
        }
        vendorBreakdown.sort((a, b) => (a.vendorName || '').localeCompare(b.vendorName || ''));

        if (batchMode) {
            const totalClients = totalClientsCount ?? 0;
            const batchSize = batchMode.batchSize;
            const nextBatchStart = (batchMode.batchIndex + 1) * batchSize;
            // When count is missing/0, continue until we get a short batch so batched button still processes all clients
            const hasMore = totalClients > 0
                ? totalClients > nextBatchStart
                : clients.length >= batchSize;
            console.log(`[Create Orders Next Week] Batch ${batchMode.batchIndex} done. totalCreated=${report.totalCreated} totalClients=${totalClients} hasMore=${hasMore}`);
            const debug = {
                clientCount: clients.length,
                workToDo: { foodOrders: foodOrders.length, mealOrders: mealOrders.length, boxOrders: boxOrders.length, customOrders: customOrders.length },
                skipped: { foodNoData: foodSkippedNoData }
            };
            return NextResponse.json({
                success: true,
                totalCreated: report.totalCreated,
                breakdown: report.breakdown,
                weekStart: weekStartStr,
                weekEnd: weekEndStr,
                errors: report.unexpectedFailures.length ? report.unexpectedFailures : undefined,
                skipped: foodSkippedNoData > 0 ? { foodNoData: foodSkippedNoData } : undefined,
                debug,
                batch: {
                    batchIndex: batchMode.batchIndex,
                    batchSize: batchMode.batchSize,
                    totalClients,
                    creationId,
                    hasMore,
                    excelRows: excelData,
                    vendorBreakdown,
                    diagnostics,
                    debug
                }
            });
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(excelData);
        ws['!cols'] = [{ wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 35 }, { wch: 25 }, { wch: 45 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Next Week Report');

        const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const excelAttachment = {
            filename: `Create_Orders_Next_Week_${weekStartStr}_to_${weekEndStr}.xlsx`,
            content: excelBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };

        // Email each vendor their own breakdown (by day) when setting is enabled
        if (sendVendorNextWeekEmails) {
            for (const v of vendorBreakdown) {
                const vendor = vendorMap.get(v.vendorId) as { email?: string } | undefined;
                const email = vendor?.email?.trim();
                if (email) {
                    await sendVendorNextWeekSummary(v.vendorName, email, weekStartStr, weekEndStr, v.byDay);
                }
            }
        }

        const debug = {
            clientCount: clients.length,
            workToDo: { foodOrders: foodOrders.length, mealOrders: mealOrders.length, boxOrders: boxOrders.length, customOrders: customOrders.length },
            skipped: { foodBlocking: 0, foodNoData: foodSkippedNoData, mealBlocking: 0 }
        };
        const reportPayload = {
            ...report,
            creationId,
            orderCreationDate: `Next week: ${weekStartStr} to ${weekEndStr}`,
            orderCreationDay: '',
            vendorBreakdown,
            debug
        };
        const attachments: { filename: string; content: Buffer; contentType: string }[] = [excelAttachment];
        const debugPayload: { debug: typeof debug; mealFocus?: Record<string, unknown> } = { debug };
        if (report.breakdown.Meal === 0) {
            debugPayload.mealFocus = {
                mealOrdersCreated: 0,
                mealWorkToDo: debug.workToDo.mealOrders,
                alert: 'No meal orders were created. Check: clients have upcoming_order.mealSelections and serviceType Food/Meal; inactive vendors are skipped per-vendor only.'
            };
        }
        attachments.push({
            filename: `Create_Orders_Next_Week_Debug_${weekStartStr}_to_${weekEndStr}.json`,
            content: Buffer.from(JSON.stringify(debugPayload, null, 2), 'utf-8'),
            contentType: 'application/json'
        });
        console.log(`[Create Orders Next Week] Finished creating orders. totalCreated=${report.totalCreated} unexpectedFailures=${report.unexpectedFailures.length}. Sending report email.`);
        if (reportEmail) {
            await sendSchedulingReport(reportPayload, reportEmail, attachments);
        } else {
            console.warn('[Create Orders Next Week] No report_email in settings. Skipping email.');
        }

        return NextResponse.json({
            success: true,
            totalCreated: report.totalCreated,
            breakdown: report.breakdown,
            reportEmail: reportEmail || null,
            weekStart: weekStartStr,
            weekEnd: weekEndStr,
            errors: report.unexpectedFailures.length ? report.unexpectedFailures : undefined,
            skipped: foodSkippedNoData > 0 ? { foodNoData: foodSkippedNoData } : undefined,
            debug
        });
    } catch (error: any) {
        console.error('[Create Orders Next Week] Error:', error);
        console.error('[Create Orders Next Week] totalCreated at time of error:', report.totalCreated, 'breakdown:', report.breakdown);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Failed to create orders for next week',
                partialTotalCreated: report.totalCreated,
                partialBreakdown: report.breakdown
            },
            { status: 500 }
        );
    }
}
