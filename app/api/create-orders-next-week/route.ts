import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DAY_NAME_TO_NUMBER, getFirstDeliveryDateInWeek } from '@/lib/order-dates';
import { sendSchedulingReport } from '@/lib/email-report';
import { getNextCreationId } from '@/lib/actions';
import * as XLSX from 'xlsx';

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

    type ClientReportRow = { clientId: string; clientName: string; ordersCreated: number; reason: string };
    const clientReportMap = new Map<string, ClientReportRow>();

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
            clientsRes,
            foodOrdersRes,
            mealOrdersRes,
            boxOrdersRes,
            customOrdersRes,
            settingsRes
        ] = await Promise.all([
            supabase.from('vendors').select('id, name, email, service_type, delivery_days, delivery_frequency, is_active, minimum_meals, cutoff_hours'),
            supabase.from('client_statuses').select('id, name, is_system_default, deliveries_allowed'),
            supabase.from('menu_items').select('id, vendor_id, name, value, price_each, is_active, category_id, minimum_order, image_url, sort_order'),
            supabase.from('breakfast_items').select('id, category_id, name, quota_value, price_each, is_active, vendor_id, image_url, sort_order'),
            supabase.from('box_types').select('id, name'),
            supabase.from('clients').select('id, full_name, status_id, service_type, parent_client_id, expiration_date, upcoming_order').is('parent_client_id', null),
            supabase.from('client_food_orders').select('*'),
            supabase.from('client_meal_orders').select('*'),
            supabase.from('client_box_orders').select('*'),
            Promise.resolve({ data: [] as any[] }), // Custom orders now from clients.upcoming_order below
            supabase.from('app_settings').select('report_email').single()
        ]);

        const allVendors = (vendorsRes.data || []).map((v: any) => ({
            id: v.id,
            name: v.name,
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
        const clients = clientsRes.data || [];
        const foodOrders = foodOrdersRes.data || [];
        const mealOrders = mealOrdersRes.data || [];
        const boxOrders = boxOrdersRes.data || [];
        // Custom orders from clients.upcoming_order (single source of truth)
        const customOrders = (clients || [])
            .filter((c: any) => c.upcoming_order && c.upcoming_order.serviceType === 'Custom')
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
        const reportEmail = (settingsRes.data as any)?.report_email || '';

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
                reason: ''
            });
        }

        const { data: maxOrderData } = await supabase.from('orders').select('order_number').order('order_number', { ascending: false }).limit(1).maybeSingle();
        let nextOrderNumber = Math.max(100000, (maxOrderData?.order_number || 0) + 1);
        const creationId = await getNextCreationId();

        async function createOrder(
            clientId: string,
            serviceType: 'Food' | 'Meal' | 'Boxes' | 'Custom',
            deliveryDate: Date,
            totalValue: number,
            totalItems: number,
            notes: string | null,
            caseId: string | undefined,
            assignedOrderNumber: number
        ) {
            const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
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
            return newOrder;
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
            const client = clientMap.get(fo.client_id);
            if (client?.service_type !== 'Food') continue;

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

                    if (await orderExists(fo.client_id, deliveryDateStr, 'Food', sel.vendorId)) continue;

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
                    if (itemsList.length === 0) continue;

                    const assignedId = nextOrderNumber++;
                    const newOrder = await createOrder(
                        fo.client_id,
                        'Food',
                        deliveryDate,
                        valueTotal,
                        itemsList.reduce((s, i) => s + i.quantity, 0),
                        (fo as any).notes || null,
                        fo.case_id,
                        assignedId
                    );
                    if (!newOrder) continue;

                    const { data: vs } = await supabase.from('order_vendor_selections').insert({ order_id: newOrder.id, vendor_id: sel.vendorId }).select().single();
                    if (vs) {
                        await supabase.from('order_items').insert(itemsList.map(i => ({ ...i, vendor_selection_id: vs.id, order_id: newOrder.id })));
                        await supabase.from('order_items').insert({
                            order_id: newOrder.id,
                            vendor_selection_id: vs.id,
                            menu_item_id: null,
                            quantity: 1,
                            unit_value: valueTotal,
                            total_value: valueTotal
                        });
                    }
                }
            }
        }

        for (const mo of mealOrders) {
            const eligible = isClientEligible(mo.client_id);
            if (!eligible.ok) {
                const row = clientReportMap.get(mo.client_id);
                if (row && !row.reason) row.reason = eligible.reason || 'Not eligible';
                continue;
            }
            const client = clientMap.get(mo.client_id);
            if (client?.service_type !== 'Food' && client?.service_type !== 'Meal') continue;

            const rawSelections = typeof mo.meal_selections === 'string' ? JSON.parse(mo.meal_selections) : mo.meal_selections;
            if (!rawSelections) continue;

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

                const assignedId = nextOrderNumber++;
                const newOrder = await createOrder(
                    mo.client_id,
                    'Meal',
                    deliveryDate,
                    orderTotalValue,
                    orderTotalItems,
                    (mo as any).notes || null,
                    mo.case_id,
                    assignedId
                );
                if (!newOrder) continue;

                const { data: vs } = await supabase.from('order_vendor_selections').insert({ order_id: newOrder.id, vendor_id: g.vendorId }).select().single();
                if (vs) {
                    await supabase.from('order_items').insert(itemsList.map(i => ({ ...i, vendor_selection_id: vs.id, order_id: newOrder.id })));
                }
            }
        }

        const boxCountByClient = new Map<string, number>();
        for (const bo of boxOrders) {
            boxCountByClient.set(bo.client_id, (boxCountByClient.get(bo.client_id) || 0) + 1);
        }

        for (const bo of boxOrders) {
            const eligible = isClientEligible(bo.client_id);
            if (!eligible.ok) {
                const row = clientReportMap.get(bo.client_id);
                if (row && !row.reason) row.reason = eligible.reason || 'Not eligible';
                continue;
            }
            const client = clientMap.get(bo.client_id);
            if (client?.service_type !== 'Boxes') continue;
            if (!bo.vendor_id) {
                const row = clientReportMap.get(bo.client_id);
                if (row && !row.reason) row.reason = 'No vendor set for box order';
                continue;
            }

            const vendor = vendorMap.get(bo.vendor_id);
            if (!vendor) continue;

            const deliveryDate = getFirstDeliveryDateInWeek(nextWeekStart, vendor.deliveryDays);
            if (!deliveryDate) continue;
            const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
            if (deliveryDateStr < weekStartStr || deliveryDateStr > weekEndStr) continue;

            const limit = boxCountByClient.get(bo.client_id) || 1;
            const { count } = await supabase
                .from('orders')
                .select('*', { count: 'exact', head: true })
                .eq('client_id', bo.client_id)
                .eq('service_type', 'Boxes')
                .gte('scheduled_delivery_date', weekStartStr)
                .lte('scheduled_delivery_date', weekEndStr);
            if ((count ?? 0) >= limit) continue;

            let boxValue = 0;
            const boxItems = typeof bo.items === 'string' ? JSON.parse(bo.items) : bo.items;
            if (boxItems) {
                for (const [id, qty] of Object.entries(boxItems)) {
                    const m = allMenuItems.find((x: any) => x.id === id);
                    if (m) boxValue += (m.price_each || m.value || 0) * Number(qty);
                }
            }
            const totalBoxValue = boxValue * (bo.quantity || 1);

            const assignedId = nextOrderNumber++;
            const newOrder = await createOrder(
                bo.client_id,
                'Boxes',
                deliveryDate,
                totalBoxValue,
                bo.quantity || 1,
                (bo as any).notes || null,
                bo.case_id,
                assignedId
            );
            if (!newOrder) continue;

            const boxTypeId = bo.box_type_id && bo.box_type_id !== '' ? bo.box_type_id : null;
            await supabase.from('order_box_selections').insert({
                order_id: newOrder.id,
                vendor_id: bo.vendor_id,
                box_type_id: boxTypeId,
                quantity: bo.quantity,
                unit_value: boxValue,
                total_value: totalBoxValue,
                items: bo.items
            });
        }

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

                if (await orderExists(co.client_id, deliveryDateStr, 'Custom', vendorId)) continue;

                const totalValue = Number(co.total_value) || 0;
                const assignedId = nextOrderNumber++;
                const newOrder = await createOrder(
                    co.client_id,
                    'Custom',
                    deliveryDate,
                    totalValue,
                    1,
                    co.notes || null,
                    co.case_id,
                    assignedId
                );
                if (!newOrder) continue;

                const { data: newVs } = await supabase.from('order_vendor_selections').insert({ order_id: newOrder.id, vendor_id: vendorId }).select().single();
                if (newVs) {
                    await supabase.from('order_items').insert({
                        order_id: newOrder.id,
                        vendor_selection_id: newVs.id,
                        menu_item_id: null,
                        custom_name: co.custom_name || co.upcoming_order?.custom_name || 'Custom Item',
                        custom_price: co.total_value,
                        quantity: 1,
                        unit_value: co.total_value,
                        total_value: co.total_value,
                        notes: co.notes
                    });
                }
            }
        }

        for (const row of clientReportMap.values()) {
            if (row.ordersCreated === 0 && !row.reason) {
                const client = clientMap.get(row.clientId);
                if (client?.service_type === 'Food') row.reason = 'No upcoming food orders';
                else if (client?.service_type === 'Meal' || client?.service_type === 'Food') row.reason = 'No upcoming meal orders';
                else if (client?.service_type === 'Boxes') row.reason = 'No upcoming box orders';
                else if (client?.service_type === 'Custom') row.reason = 'No upcoming custom orders';
                else row.reason = 'No upcoming orders';
            }
        }

        const excelData = Array.from(clientReportMap.values()).map(row => ({
            'Client ID': row.clientId,
            'Client Name': row.clientName,
            'Orders Created': row.ordersCreated,
            'Reason (if none)': row.reason || '-'
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(excelData);
        ws['!cols'] = [{ wch: 15 }, { wch: 30 }, { wch: 18 }, { wch: 50 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Next Week Report');

        const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const excelAttachment = {
            filename: `Create_Orders_Next_Week_${weekStartStr}_to_${weekEndStr}.xlsx`,
            content: excelBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };

        const reportPayload = {
            ...report,
            creationId,
            orderCreationDate: `Next week: ${weekStartStr} to ${weekEndStr}`,
            orderCreationDay: ''
        };
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
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to create orders for next week' },
            { status: 500 }
        );
    }
}
