import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DAY_NAME_TO_NUMBER, getFirstDeliveryDateInWeek } from '@/lib/order-dates';
import { vendorSelectionsToDeliveryDayOrders } from '@/lib/upcoming-order-converter';
import { sendSchedulingReport, sendVendorNextWeekSummary, type VendorBreakdownItem } from '@/lib/email-report';
import { getNextCreationId } from '@/lib/actions';
import { hasBlockingCleanupIssues, type BlockContext } from '@/lib/order-creation-block';
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

        // Build block context: clients with inactive/deleted items or invalid vendors must not get orders (fix on cleanup page first)
        const { data: itemCategories } = await supabase.from('item_categories').select('id, is_active');
        const { data: breakfastCategories } = await supabase.from('breakfast_categories').select('id, is_active');
        const activeItemCategoryIds = new Set<string>(
            (itemCategories || []).filter((r: { is_active?: boolean }) => r.is_active === true).map((r: { id: string }) => r.id)
        );
        const activeBreakfastCategoryIds = new Set<string>(
            (breakfastCategories || []).filter((r: { is_active?: boolean }) => r.is_active === true).map((r: { id: string }) => r.id)
        );
        const allMenuItemIds = new Set<string>((allMenuItems as { id: string }[]).map((r) => r.id));
        const allBreakfastItemIds = new Set<string>((allMealItems as { id: string }[]).map((r) => r.id));
        const activeMenuItemIds = new Set<string>(
            (allMenuItems as { id: string; is_active?: boolean; category_id?: string | null }[]).filter((r) => {
                if (r.is_active !== true) return false;
                const cid = r.category_id;
                if (cid == null || cid === '') return true;
                return activeItemCategoryIds.size === 0 || activeItemCategoryIds.has(cid);
            }).map((r) => r.id)
        );
        const activeBreakfastItemIds = new Set<string>(
            (allMealItems as { id: string; is_active?: boolean; category_id?: string | null }[]).filter((r) => {
                if (r.is_active !== true) return false;
                const cid = r.category_id;
                if (cid == null || cid === '') return true;
                return activeBreakfastCategoryIds.size === 0 || activeBreakfastCategoryIds.has(cid);
            }).map((r) => r.id)
        );
        const vendorActiveMap = new Map<string, { is_active: boolean }>();
        for (const v of vendorsRes.data || []) {
            vendorActiveMap.set(v.id, { is_active: !!v.is_active });
        }
        const blockCtx: BlockContext = {
            activeMenuItemIds,
            activeBreakfastItemIds,
            allMenuItemIds,
            allBreakfastItemIds,
            vendorMap: vendorActiveMap
        };

        // Derive food/meal/box/custom from clients.upcoming_order only (single source of truth per UPCOMING_ORDER_SCHEMA)
        // Type is determined by upcoming_order.serviceType, not clients.service_type.
        // Food: serviceType 'Food' (or legacy missing), with deliveryDayOrders or vendorSelections
        const foodOrders: { client_id: string; delivery_day_orders: Record<string, { vendorSelections?: any[] }>; notes: string | null; case_id: string | null }[] = [];
        for (const c of clients || []) {
            const uo = c.upcoming_order;
            if (!uo || typeof uo !== 'object') continue;
            if (hasBlockingCleanupIssues(uo, blockCtx)) continue; // skip until fixed on cleanup page
            // Only Food payloads (or legacy without serviceType) have delivery-day food data
            const isFoodType = uo.serviceType === 'Food' || uo.serviceType === undefined;
            if (!isFoodType) continue;

            let delivery_day_orders: Record<string, { vendorSelections?: any[] }> | null = null;

            if (uo.deliveryDayOrders && typeof uo.deliveryDayOrders === 'object' && Object.keys(uo.deliveryDayOrders).length > 0) {
                delivery_day_orders = uo.deliveryDayOrders;
            } else if (Array.isArray(uo.vendorSelections) && uo.vendorSelections.length > 0) {
                const converted = vendorSelectionsToDeliveryDayOrders(uo.vendorSelections);
                if (Object.keys(converted).length > 0) delivery_day_orders = converted;
            }

            if (delivery_day_orders && Object.keys(delivery_day_orders).length > 0) {
                foodOrders.push({
                    client_id: c.id,
                    delivery_day_orders,
                    notes: uo.notes ?? null,
                    case_id: uo.caseId ?? null
                });
            }
        }
        // Meal: serviceType 'Food' or 'Meal' with mealSelections (schema allows both in same payload)
        const mealOrders = (clients || [])
            .filter((c: any) => {
                const uo = c.upcoming_order;
                if (!uo || typeof uo !== 'object' || !uo.mealSelections) return false;
                if (hasBlockingCleanupIssues(uo, blockCtx)) return false;
                return uo.serviceType === 'Food' || uo.serviceType === 'Meal';
            })
            .map((c: any) => ({
                client_id: c.id,
                meal_selections: c.upcoming_order.mealSelections,
                notes: c.upcoming_order.notes ?? null,
                case_id: c.upcoming_order.caseId ?? null
            }));
        // Boxes: serviceType 'Boxes' with boxOrders
        const boxOrders: { client_id: string; box_type_id?: string; vendor_id?: string; quantity: number; items: any; item_notes?: any; case_id?: string; notes?: string }[] = [];
        for (const c of clients || []) {
            const uo = c.upcoming_order;
            if (!uo || typeof uo !== 'object' || uo.serviceType !== 'Boxes' || !uo.boxOrders?.length) continue;
            if (hasBlockingCleanupIssues(uo, blockCtx)) continue;
            for (const b of uo.boxOrders) {
                boxOrders.push({
                    client_id: c.id,
                    box_type_id: b.boxTypeId ?? undefined,
                    vendor_id: b.vendorId ?? undefined,
                    quantity: b.quantity ?? 1,
                    items: b.items ?? {},
                    item_notes: b.itemNotes,
                    case_id: uo.caseId ?? undefined,
                    notes: uo.notes
                });
            }
        }
        // Custom orders from clients.upcoming_order (single source of truth)
        const customOrders = (clients || [])
            .filter((c: any) => {
                const uo = c.upcoming_order;
                return uo && uo.serviceType === 'Custom' && !hasBlockingCleanupIssues(uo, blockCtx);
            })
            .map((c: any) => ({
                client_id: c.id,
                id: c.id,
                delivery_day: c.upcoming_order?.deliveryDay ?? c.upcoming_order?.delivery_day,
                total_value: c.upcoming_order?.custom_price ?? c.upcoming_order?.totalValue ?? 0,
                notes: c.upcoming_order?.notes ?? null,
                case_id: c.upcoming_order?.caseId ?? null,
                custom_name: c.upcoming_order?.custom_name,
                vendorId: c.upcoming_order?.vendorId,
                upcoming_order: c.upcoming_order
            }))
            .filter((co: any) => co.delivery_day);

        console.log(`[Create Orders Next Week] Work to do: foodOrders=${foodOrders.length} mealOrders=${mealOrders.length} boxOrders=${boxOrders.length} customOrders=${customOrders.length}`);

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

            // One Meal order per mealSelections entry (each can be a different vendor). Multiple meal orders per client per week are supported.
            for (const [mealType, group] of Object.entries(rawSelections)) {
                const g = group as { vendorId?: string; items?: Record<string, number>; itemNotes?: Record<string, string> };
                if (!g?.vendorId) continue;
                const vendor = vendorMap.get(g.vendorId);
                if (!vendor) continue;

                const deliveryDate = getFirstDeliveryDateInWeek(nextWeekStart, vendor.deliveryDays);
                if (!deliveryDate) continue;
                const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
                if (deliveryDateStr < weekStartStr || deliveryDateStr > weekEndStr) continue;

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

                const clientName = clientMap.get(mo.client_id)?.full_name ?? mo.client_id;
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
                    diagnostics.push({ clientId: mo.client_id, clientName, vendorId: g.vendorId, vendorName: vendor.name, date: deliveryDateStr, orderType: 'Meal', outcome: 'failed', reason: report.unexpectedFailures[report.unexpectedFailures.length - 1]?.reason ?? 'createOrder failed' });
                    continue;
                }

                const { data: vs } = await supabase.from('order_vendor_selections').insert({ order_id: newOrder.id, vendor_id: g.vendorId }).select().single();
                if (vs) {
                    recordVendorOrder(g.vendorId, deliveryDateStr);
                    recordReportOrder(mo.client_id, g.vendorId, 'Meal');
                    await supabase.from('order_items').insert(itemsList.map(i => ({ ...i, vendor_selection_id: vs.id, order_id: newOrder.id })));
                    diagnostics.push({ clientId: mo.client_id, clientName, vendorId: g.vendorId, vendorName: vendor.name, date: deliveryDateStr, orderType: 'Meal', outcome: 'created', orderId: newOrder.id });
                } else {
                    diagnostics.push({ clientId: mo.client_id, clientName, vendorId: g.vendorId, vendorName: vendor.name, date: deliveryDateStr, orderType: 'Meal', outcome: 'failed', orderId: newOrder.id, reason: 'order_vendor_selections insert failed' });
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
                const st = uo && typeof uo === 'object' ? (uo.serviceType as string) : undefined;
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
            const hasMore = totalClients > (batchMode.batchIndex + 1) * batchMode.batchSize;
            console.log(`[Create Orders Next Week] Batch ${batchMode.batchIndex} done. totalCreated=${report.totalCreated} hasMore=${hasMore}`);
            return NextResponse.json({
                success: true,
                totalCreated: report.totalCreated,
                breakdown: report.breakdown,
                weekStart: weekStartStr,
                weekEnd: weekEndStr,
                errors: report.unexpectedFailures.length ? report.unexpectedFailures : undefined,
                batch: {
                    batchIndex: batchMode.batchIndex,
                    batchSize: batchMode.batchSize,
                    totalClients,
                    creationId,
                    hasMore,
                    excelRows: excelData,
                    vendorBreakdown,
                    diagnostics
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

        const reportPayload = {
            ...report,
            creationId,
            orderCreationDate: `Next week: ${weekStartStr} to ${weekEndStr}`,
            orderCreationDay: '',
            vendorBreakdown
        };
        console.log(`[Create Orders Next Week] Finished creating orders. totalCreated=${report.totalCreated} unexpectedFailures=${report.unexpectedFailures.length}. Sending report email.`);
        if (reportEmail) {
            await sendSchedulingReport(reportPayload, reportEmail, [excelAttachment]);
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
            errors: report.unexpectedFailures.length ? report.unexpectedFailures : undefined
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
