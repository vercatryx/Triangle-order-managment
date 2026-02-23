/**
 * Shared logic for computing and creating "missing" orders for a delivery week
 * using order_history snapshot at the cutoff (e.g. Tuesday before that week).
 * Used by the Missing Orders page API and by the backfill script (script can be refactored to use this).
 */

import { getFirstDeliveryDateInWeek, DAY_NAME_TO_NUMBER } from './order-dates';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ExpectedOrder = {
  client_id: string;
  clientName: string;
  scheduled_delivery_date: string;
  service_type: 'Food' | 'Meal' | 'Boxes' | 'Custom';
  vendor_id: string;
  vendorName: string;
  mealType?: string;
  mealTypeCanonical?: string;
  payload: {
    totalValue: number;
    totalItems: number;
    notes: string | null;
    case_id: string | undefined;
    itemsList?: { menu_item_id: string; quantity: number; unit_value: number; total_value: number; notes: string | null }[];
    boxSelections?: any[];
    customNames?: string[];
    customTotalValue?: number;
  };
};

export type SnapshotAtCutoffResult = {
  snapshot: Record<string, unknown> | null;
  /** ISO timestamp of the order_history entry that was used (when the snapshot was saved). */
  timestamp: string | null;
  createdAt: string | null;
};

function snapshotAtCutoff(orderHistory: any[], cutoff: Date): SnapshotAtCutoffResult {
  const upcoming = (orderHistory || []).filter(
    (e: any) => e?.type === 'upcoming' && (e.orderData != null || e.order_data != null)
  );
  const atOrBefore = upcoming.filter((e: any) => {
    const t = e.timestamp || e.created_at;
    return t && new Date(t) <= cutoff;
  });
  if (atOrBefore.length === 0) return { snapshot: null, timestamp: null, createdAt: null };
  atOrBefore.sort((a: any, b: any) => new Date(b.timestamp || b.created_at).getTime() - new Date(a.timestamp || a.created_at).getTime());
  const entry = atOrBefore[0];
  const t = entry.timestamp || entry.created_at;
  return {
    snapshot: entry.orderData ?? entry.order_data ?? null,
    timestamp: t ? new Date(t).toISOString() : null,
    createdAt: entry.created_at ? new Date(entry.created_at).toISOString() : null
  };
}

function clientUpdatedAfterCutoff(orderHistory: any[], cutoff: Date): boolean {
  const upcoming = (orderHistory || []).filter(
    (e: any) => e?.type === 'upcoming' && (e.orderData != null || e.order_data != null)
  );
  return upcoming.some((e: any) => {
    const t = e.timestamp || e.created_at;
    return t && new Date(t) > cutoff;
  });
}

function normalizeMealType(key: string): string {
  const idx = key.indexOf('_');
  return idx > 0 ? key.slice(0, idx) : key;
}

/** Normalize vendor selection items from various stored shapes to { itemId: quantity }. */
function getItemsMapFromVendorSelection(vs: any): Record<string, number> {
  if (!vs || typeof vs !== 'object') return {};
  const raw =
    vs.items ?? vs.itemQuantities ?? vs.menu_items ?? (vs.item_quantities as Record<string, number> | undefined);
  if (!raw || typeof raw !== 'object') return {};
  if (Array.isArray(raw)) {
    const out: Record<string, number> = {};
    for (const entry of raw) {
      if (entry && typeof entry === 'object') {
        const id = (entry as any).menu_item_id ?? (entry as any).menuItemId ?? (entry as any).itemId ?? (entry as any).id;
        const q = Number((entry as any).quantity ?? (entry as any).qty ?? 0);
        if (id && q > 0) out[String(id)] = q;
      }
    }
    return out;
  }
  const out: Record<string, number> = {};
  for (const [id, val] of Object.entries(raw)) {
    const q = typeof val === 'number' ? val : Number((val as any)?.quantity ?? (val as any)?.qty ?? val ?? 0);
    if (q > 0) out[String(id)] = q;
  }
  return out;
}

/** Get the date for a given day name (e.g. "Monday") within the week that starts on weekStart (Sunday). */
function getDateForDayNameInWeek(weekStart: Date, dayName: string): Date | null {
  const dayNum = (DAY_NAME_TO_NUMBER as Record<string, number>)[dayName];
  if (dayNum == null) return null;
  const d = new Date(weekStart);
  d.setHours(0, 0, 0, 0);
  d.setDate(weekStart.getDate() + dayNum);
  return d;
}

/** Get cutoff datetime for the week that starts on weekStartStr (Sunday). Cutoff is in the week before. */
export async function getCutoffForWeek(supabase: SupabaseClient, weekStartStr: string): Promise<{ date: Date; dayName: string }> {
  const { data: settings } = await supabase.from('app_settings').select('weekly_cutoff_day, weekly_cutoff_time').single();
  const dayName = (settings as any)?.weekly_cutoff_day || 'Tuesday';
  const timeStr = (settings as any)?.weekly_cutoff_time || '00:00';
  const [h, m] = timeStr.split(':').map(Number);
  const weekStart = new Date(weekStartStr + 'T00:00:00');
  const weekBefore = new Date(weekStart);
  weekBefore.setDate(weekStart.getDate() - 7);
  const dayNum = (DAY_NAME_TO_NUMBER as Record<string, number>)[dayName] ?? 2;
  const cutoff = new Date(weekBefore);
  cutoff.setDate(weekBefore.getDate() + dayNum);
  cutoff.setHours(h || 0, m || 0, 0, 0);
  return { date: cutoff, dayName };
}

/**
 * Compute missing orders for a delivery week using order_history snapshot at cutoff.
 * Optionally restrict to specific client IDs.
 */
export async function computeMissingOrders(
  supabase: SupabaseClient,
  weekStartStr: string,
  weekEndStr: string,
  options?: { clientIds?: string[] }
): Promise<{
  missing: ExpectedOrder[];
  expectedCount: number;
  /** Cutoff datetime used (e.g. Tuesday before the week). */
  cutoffUsedAt: string;
  /** Day name from app_settings (e.g. "Tuesday") for display. */
  cutoffDayName: string;
  /** Per client: the order_history entry timestamp that was used, or source when using current upcoming_order. */
  clientSnapshotUsedAt: Record<string, { timestamp: string | null; createdAt: string | null; clientName: string; source: 'order_history' | 'upcoming_order' }>;
  /** All expected orders with existing order number when matched. */
  expectedWithDetails: (ExpectedOrder & { existingOrderNumber: number | null })[];
  /** Raw upcoming order config per client (snapshot as it was) for display. */
  snapshotOrderConfig: Record<string, any>;
  /** Existing orders in the week per client, with status matched/extra. */
  existingOrdersByClient: Record<string, { orderId: string; order_number: number; scheduled_delivery_date: string; vendorName: string; mealType: string; status: 'matched' | 'extra' }[]>;
}> {
  const { date: cutoffDate, dayName: cutoffDayName } = await getCutoffForWeek(supabase, weekStartStr);
  const cutoffUsedAt = cutoffDate.toISOString();
  const weekStartDate = new Date(weekStartStr + 'T00:00:00');
  const clientSnapshotUsedAt: Record<string, { timestamp: string | null; createdAt: string | null; clientName: string; source: 'order_history' | 'upcoming_order' }> = {};
  /** Raw upcoming order config (as it was in the snapshot) per client, for display. */
  const snapshotOrderConfig: Record<string, any> = {};

  const [
    vendorsRes,
    statusesRes,
    menuItemsRes,
    mealItemsRes,
    boxTypesRes,
    breakfastCategoriesRes,
    itemCategoriesRes
  ] = await Promise.all([
    supabase.from('vendors').select('id, name, delivery_days, is_active'),
    supabase.from('client_statuses').select('id, name, deliveries_allowed'),
    supabase.from('menu_items').select('id, vendor_id, value, price_each, is_active, category_id'),
    supabase.from('breakfast_items').select('id, category_id, price_each, is_active'),
    supabase.from('box_types').select('id, name'),
    supabase.from('breakfast_categories').select('id, name, meal_type'),
    supabase.from('item_categories').select('id, name, meal_type')
  ]);

  const allVendors = (vendorsRes.data || []) as { id: string; name: string; delivery_days?: string[]; is_active?: boolean }[];
  const allStatuses = (statusesRes.data || []) as { id: string; name: string; deliveries_allowed?: boolean }[];
  const allMenuItems = (menuItemsRes.data || []) as any[];
  const allMealItems = ((mealItemsRes.data || []) as any[]).map((i) => ({ ...i, itemType: 'meal' as const }));
  const allBreakfastCategories = (breakfastCategoriesRes.data || []) as { id: string; name?: string; meal_type: string; is_active?: boolean }[];
  const allItemCategories = (itemCategoriesRes.data || []) as { id: string; name?: string; meal_type?: string; is_active?: boolean }[];

  const activeMealTypes = new Set<string>();
  for (const c of allBreakfastCategories) {
    if (c.is_active !== false) activeMealTypes.add(c.meal_type || 'Lunch');
  }
  for (const c of allItemCategories) {
    const mt = (c as any).meal_type;
    if (mt && (c as any).is_active !== false) activeMealTypes.add(mt);
  }
  if (activeMealTypes.size === 0) {
    for (const c of allBreakfastCategories) activeMealTypes.add(c.meal_type || 'Lunch');
    for (const c of allItemCategories) {
      const mt = (c as any).meal_type;
      if (mt) activeMealTypes.add(mt);
    }
  }

  const categoryIdToMealType = new Map<string, string>(allBreakfastCategories.map((c) => [c.id, c.meal_type || 'Lunch']));
  const mealItemIdToMealType = new Map<string, string>(
    allMealItems.map((i: any) => [i.id, categoryIdToMealType.get(i.category_id) || 'Lunch'])
  );
  const itemCategoryIdToMealType = new Map<string, string>(
    allItemCategories.map((c) => [c.id, (c as any).meal_type || 'Lunch'])
  );
  const menuItemIdToMealType = new Map<string, string>(
    allMenuItems.map((i: any) => [i.id, itemCategoryIdToMealType.get(i.category_id) || 'Lunch'])
  );
  const categoryNameOrTypeToCanonicalMealType = new Map<string, string>();
  for (const c of allBreakfastCategories) {
    if (c.meal_type) categoryNameOrTypeToCanonicalMealType.set(c.meal_type, c.meal_type);
    if (c.name) categoryNameOrTypeToCanonicalMealType.set(c.name, c.meal_type || 'Lunch');
  }
  for (const c of allItemCategories) {
    const mt = (c as any).meal_type;
    if (mt) categoryNameOrTypeToCanonicalMealType.set(mt, mt);
    if (c.name) categoryNameOrTypeToCanonicalMealType.set(c.name, mt || 'Lunch');
  }

  const vendorMap = new Map(allVendors.map((v) => [v.id, { ...v, deliveryDays: v.delivery_days || [] }]));
  const vendorActiveMap = new Map<string, boolean>(allVendors.map((v) => [v.id, !!v.is_active]));
  const statusMap = new Map(allStatuses.map((s) => [s.id, s]));
  const mealItemById = new Map<string, any>();
  const menuItemById = new Map<string, any>();
  for (const i of allMealItems) {
    mealItemById.set(i.id, i);
    if (typeof i.id === 'string') mealItemById.set(i.id.toLowerCase(), i);
  }
  for (const i of allMenuItems) {
    menuItemById.set(i.id, i);
    if (typeof i.id === 'string') menuItemById.set(i.id.toLowerCase(), i);
  }
  function resolveItem(itemId: string): { item: any; itemType: 'meal' | 'menu' } | null {
    const m = mealItemById.get(itemId) ?? mealItemById.get(String(itemId).toLowerCase());
    if (m) return { item: m, itemType: 'meal' };
    const u = menuItemById.get(itemId) ?? menuItemById.get(String(itemId).toLowerCase());
    if (u) return { item: u, itemType: 'menu' };
    return null;
  }

  let clients: any[];
  if (options?.clientIds?.length) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, full_name, status_id, expiration_date, order_history, upcoming_order')
      .in('id', options.clientIds)
      .is('parent_client_id', null);
    if (error) throw error;
    clients = data || [];
  } else {
    const { data, error } = await supabase
      .from('clients')
      .select('id, full_name, status_id, expiration_date, order_history, upcoming_order')
      .is('parent_client_id', null);
    if (error) throw error;
    clients = data || [];
  }

  const todayStr = new Date().toISOString().split('T')[0];
  function isEligible(client: any): boolean {
    const status = statusMap.get(client.status_id);
    if (!status?.deliveries_allowed) return false;
    if (client.expiration_date && client.expiration_date < todayStr) return false;
    return true;
  }

  const expectedOrders: ExpectedOrder[] = [];

  for (const client of clients) {
    if (!isEligible(client)) continue;
    const updatedAfter = clientUpdatedAfterCutoff(client.order_history || [], cutoffDate);
    const { snapshot: snapshotData, timestamp: snapshotTimestamp, createdAt: snapshotCreatedAt } = snapshotAtCutoff(client.order_history || [], cutoffDate);
    const uo = (updatedAfter ? (snapshotData ?? client.upcoming_order) : (client.upcoming_order ?? snapshotData)) as any;
    if (!uo || typeof uo !== 'object') continue;

    clientSnapshotUsedAt[client.id] = {
      timestamp: snapshotTimestamp ?? null,
      createdAt: snapshotCreatedAt ?? null,
      clientName: client.full_name || client.id,
      source: snapshotTimestamp ? 'order_history' : 'upcoming_order'
    };
    snapshotOrderConfig[client.id] = uo && typeof uo === 'object' ? JSON.parse(JSON.stringify(uo)) : null;

    const st = uo.serviceType ?? uo.service_type;
    const clientName = client.full_name || client.id;

    const mealSel = uo.mealSelections ?? uo.meal_selections;
    if ((st === 'Food' || st === 'Meal') && mealSel && typeof mealSel === 'object') {
      for (const [_mealType, group] of Object.entries(mealSel)) {
        const g = group as { vendorId?: string; vendor_id?: string; items?: Record<string, number>; itemNotes?: Record<string, string> };
        const vid = g?.vendorId ?? g?.vendor_id;
        if (!vid) continue;
        const vendor = vendorMap.get(vid);
        if (!vendor || vendorActiveMap.get(vid) === false) continue;
        const deliveryDate = getFirstDeliveryDateInWeek(weekStartDate, vendor.deliveryDays);
        if (!deliveryDate) continue;
        const dateStr = deliveryDate.toISOString().split('T')[0];
        if (dateStr < weekStartStr || dateStr > weekEndStr) continue;
        let orderTotalValue = 0;
        let orderTotalItems = 0;
        const itemsList: { menu_item_id: string; quantity: number; unit_value: number; total_value: number; notes: string | null }[] = [];
        if (g.items) {
          for (const [itemId, qty] of Object.entries(g.items)) {
            const q = Number(qty);
            if (q <= 0) continue;
            const resolved = resolveItem(itemId);
            if (!resolved) continue;
            const price = resolved.itemType === 'meal' ? (resolved.item.price_each ?? 0) : (resolved.item.price_each ?? resolved.item.value ?? 0);
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
        const mealTypeCanonical = categoryNameOrTypeToCanonicalMealType.get(_mealType) ?? categoryNameOrTypeToCanonicalMealType.get(normalizeMealType(_mealType)) ?? normalizeMealType(_mealType);
        expectedOrders.push({
          client_id: client.id,
          clientName,
          scheduled_delivery_date: dateStr,
          service_type: 'Meal',
          vendor_id: vid,
          vendorName: vendor.name,
          mealType: _mealType,
          mealTypeCanonical,
          payload: {
            totalValue: orderTotalValue,
            totalItems: orderTotalItems,
            notes: uo.notes ?? null,
            case_id: uo.caseId ?? uo.case_id,
            itemsList
          }
        });
      }
    }

    // Food: build expected orders from deliveryDayOrders (day -> vendorSelections) and top-level vendorSelections
    if (st === 'Food') {
      const ddo = uo.deliveryDayOrders ?? uo.delivery_day_orders;
      if (ddo && typeof ddo === 'object') {
        for (const [dayName, dayData] of Object.entries(ddo)) {
          const dayObj = dayData as { vendorSelections?: any[]; vendor_selections?: any[] };
          const selections = dayObj?.vendorSelections ?? dayObj?.vendor_selections ?? [];
          const deliveryDate = getDateForDayNameInWeek(weekStartDate, dayName);
          if (!deliveryDate) continue;
          const dateStr = deliveryDate.toISOString().split('T')[0];
          if (dateStr < weekStartStr || dateStr > weekEndStr) continue;
          for (const vs of selections) {
            const vid = vs?.vendorId ?? vs?.vendor_id;
            if (!vid) continue;
            const vendor = vendorMap.get(vid);
            if (!vendor || vendorActiveMap.get(vid) === false) continue;
            let orderTotalValue = 0;
            let orderTotalItems = 0;
            const itemsList: { menu_item_id: string; quantity: number; unit_value: number; total_value: number; notes: string | null }[] = [];
            const itemsMap = getItemsMapFromVendorSelection(vs);
            if (Object.keys(itemsMap).length > 0) {
              for (const [itemId, qty] of Object.entries(itemsMap)) {
                const q = Number(qty);
                if (q <= 0) continue;
                const resolved = resolveItem(itemId);
                if (!resolved) continue;
                const price = resolved.itemType === 'meal' ? (resolved.item.price_each ?? 0) : (resolved.item.price_each ?? resolved.item.value ?? 0);
                orderTotalValue += price * q;
                orderTotalItems += q;
                itemsList.push({
                  menu_item_id: itemId,
                  quantity: q,
                  unit_value: price,
                  total_value: price * q,
                  notes: vs.itemNotes?.[itemId] || null
                });
              }
            }
            expectedOrders.push({
              client_id: client.id,
              clientName,
              scheduled_delivery_date: dateStr,
              service_type: 'Food',
              vendor_id: vid,
              vendorName: vendor.name,
              payload: {
                totalValue: orderTotalValue,
                totalItems: orderTotalItems,
                notes: uo.notes ?? null,
                case_id: uo.caseId ?? uo.case_id,
                itemsList
              }
            });
          }
        }
      }
      const topVs = uo.vendorSelections ?? uo.vendor_selections;
      if (Array.isArray(topVs) && topVs.length > 0) {
        for (const vs of topVs) {
          const vid = (vs as any)?.vendorId ?? (vs as any)?.vendor_id;
          if (!vid) continue;
          const vendor = vendorMap.get(vid);
          if (!vendor || vendorActiveMap.get(vid) === false) continue;
          const deliveryDate = getFirstDeliveryDateInWeek(weekStartDate, vendor.deliveryDays);
          if (!deliveryDate) continue;
          const dateStr = deliveryDate.toISOString().split('T')[0];
          if (dateStr < weekStartStr || dateStr > weekEndStr) continue;
          let orderTotalValue = 0;
          let orderTotalItems = 0;
          const itemsList: { menu_item_id: string; quantity: number; unit_value: number; total_value: number; notes: string | null }[] = [];
          const itemsMap = getItemsMapFromVendorSelection(vs);
          if (Object.keys(itemsMap).length > 0) {
            for (const [itemId, qty] of Object.entries(itemsMap)) {
              const q = Number(qty);
              if (q <= 0) continue;
              const resolved = resolveItem(itemId);
              if (!resolved) continue;
              const price = resolved.itemType === 'meal' ? (resolved.item.price_each ?? 0) : (resolved.item.price_each ?? resolved.item.value ?? 0);
              orderTotalValue += price * q;
              orderTotalItems += q;
              itemsList.push({
                menu_item_id: itemId,
                quantity: q,
                unit_value: price,
                total_value: price * q,
                notes: (vs as any)?.itemNotes?.[itemId] ?? (vs as any)?.item_notes?.[itemId] ?? null
              });
            }
          }
          expectedOrders.push({
            client_id: client.id,
            clientName,
            scheduled_delivery_date: dateStr,
            service_type: 'Food',
            vendor_id: vid,
            vendorName: vendor.name,
            payload: {
              totalValue: orderTotalValue,
              totalItems: orderTotalItems,
              notes: uo.notes ?? null,
              case_id: uo.caseId ?? uo.case_id,
              itemsList
            }
          });
        }
      }
    }
  }

  const weekEndInclusive = weekEndStr + 'T23:59:59.999';
  let orderClientIdsFilter: string[] | undefined = options?.clientIds;
  if (orderClientIdsFilter?.length) {
    const { data: deps } = await supabase.from('clients').select('id').in('parent_client_id', orderClientIdsFilter);
    const depIds = (deps || []).map((d: any) => d.id);
    orderClientIdsFilter = [...new Set([...orderClientIdsFilter, ...depIds])];
  }
  let ordersList: any[] = [];
  const pageSize = 1000;
  let offset = 0;
  let page: any[];
  do {
    let q = supabase
      .from('orders')
      .select('id, client_id, scheduled_delivery_date, service_type, order_number, total_value, total_items')
      .gte('scheduled_delivery_date', weekStartStr)
      .lte('scheduled_delivery_date', weekEndInclusive);
    if (orderClientIdsFilter?.length) {
      q = q.in('client_id', orderClientIdsFilter);
    }
    const { data } = await q.range(offset, offset + pageSize - 1);
    page = data || [];
    ordersList = ordersList.concat(page);
    offset += pageSize;
  } while (page.length === pageSize);

  const orderIds = ordersList.map((o: any) => o.id);
  const orderIdToOrderNumber = new Map<string, number>(ordersList.map((o: any) => [o.id, Number(o.order_number ?? 0)]));
  const distinctOrderClientIds = [...new Set(ordersList.map((o: any) => o.client_id).filter(Boolean))];
  const clientIdToParent = new Map<string, string>();
  if (distinctOrderClientIds.length > 0) {
    const { data: orderClients } = await supabase
      .from('clients')
      .select('id, parent_client_id')
      .in('id', distinctOrderClientIds);
    for (const row of orderClients || []) {
      const r = row as { id: string; parent_client_id: string | null };
      if (r.parent_client_id) clientIdToParent.set(r.id, r.parent_client_id);
    }
  }
  const effectiveClientId = (cid: string) => clientIdToParent.get(cid) || cid;

  let allVs: { order_id: string; vendor_id: string }[] = [];
  if (orderIds.length > 0) {
    const batchSize = 200;
    for (let i = 0; i < orderIds.length; i += batchSize) {
      const batch = orderIds.slice(i, i + batchSize);
      const { data } = await supabase.from('order_vendor_selections').select('order_id, vendor_id').in('order_id', batch);
      allVs = allVs.concat((data || []) as { order_id: string; vendor_id: string }[]);
    }
  }
  const vsByOrderId = new Map<string, { vendor_id: string }[]>();
  for (const vs of allVs) {
    if (!vsByOrderId.has(vs.order_id)) vsByOrderId.set(vs.order_id, []);
    vsByOrderId.get(vs.order_id)!.push({ vendor_id: vs.vendor_id });
  }

  const existingKeyCount = new Map<string, number>();
  /** One order id per key so we can set existingOrderNumber for non-Meal expected orders. */
  const existingKeyToOrderId = new Map<string, string>();
  const mealOrderIds = ordersList.filter((o: any) => o.service_type === 'Meal').map((o: any) => o.id);
  const orderIdToMealType = new Map<string, string>();
  const orderIdUnclassified = new Set<string>();
  if (mealOrderIds.length > 0) {
    let allItems: { order_id: string; meal_item_id: string | null; menu_item_id: string | null }[] = [];
    for (let i = 0; i < mealOrderIds.length; i += 200) {
      const batch = mealOrderIds.slice(i, i + 200);
      const { data } = await supabase.from('order_items').select('order_id, meal_item_id, menu_item_id').in('order_id', batch);
      allItems = allItems.concat((data || []) as { order_id: string; meal_item_id: string | null; menu_item_id: string | null }[]);
    }
    const mealTypesByOrderId = new Map<string, Set<string>>();
    for (const row of allItems) {
      if (row.meal_item_id) {
        const mt = mealItemIdToMealType.get(row.meal_item_id);
        if (mt) {
          if (!mealTypesByOrderId.has(row.order_id)) mealTypesByOrderId.set(row.order_id, new Set());
          mealTypesByOrderId.get(row.order_id)!.add(mt);
        }
      }
      if (row.menu_item_id) {
        const mt = menuItemIdToMealType.get(row.menu_item_id);
        if (mt) {
          if (!mealTypesByOrderId.has(row.order_id)) mealTypesByOrderId.set(row.order_id, new Set());
          mealTypesByOrderId.get(row.order_id)!.add(mt);
        }
      }
    }
    const orderIdsWithItems = new Set(allItems.map((r) => r.order_id));
    for (const oid of mealOrderIds) {
      const types = mealTypesByOrderId.get(oid);
      if (types && types.size > 0) {
        orderIdToMealType.set(oid, [...types].sort()[0]);
      } else if (orderIdsWithItems.has(oid)) {
        orderIdToMealType.set(oid, 'Lunch');
      } else {
        orderIdUnclassified.add(oid);
      }
    }
  }

  for (const o of ordersList) {
    const effClient = effectiveClientId(o.client_id);
    const dateStr = o.scheduled_delivery_date ? String(o.scheduled_delivery_date).slice(0, 10) : '';
    if (o.service_type === 'Boxes') {
      const key = `${effClient}|Boxes`;
      existingKeyCount.set(key, (existingKeyCount.get(key) || 0) + 1);
      existingKeyToOrderId.set(key, o.id);
      continue;
    }
    if (o.service_type === 'Meal') {
      const mealType = orderIdToMealType.get(o.id);
      if (mealType) {
        for (const vs of vsByOrderId.get(o.id) || []) {
          const key = `${o.client_id}|${dateStr}|Meal|${vs.vendor_id}|${mealType}`;
          existingKeyCount.set(key, (existingKeyCount.get(key) || 0) + 1);
        }
      } else if (orderIdUnclassified.has(o.id)) {
        for (const vs of vsByOrderId.get(o.id) || []) {
          const key = `${o.client_id}|${dateStr}|Meal|${vs.vendor_id}|__any_meal__`;
          existingKeyCount.set(key, (existingKeyCount.get(key) || 0) + 1);
        }
      }
      continue;
    }
    for (const vs of vsByOrderId.get(o.id) || []) {
      const key = `${effClient}|${dateStr}|${o.service_type}|${vs.vendor_id}`;
      existingKeyCount.set(key, (existingKeyCount.get(key) || 0) + 1);
      existingKeyToOrderId.set(key, o.id);
    }
  }

  const clientDateKey = (c: string, d: string) => `${String(c).trim()}|${String(d).slice(0, 10)}`;
  const norm = (s: string) => (s || '').trim().toLowerCase();
  const existingByClientDate = new Map<string, { orderId: string; mealType: string }[]>();
  for (const o of ordersList) {
    if (o.service_type !== 'Meal') continue;
    const dateStr = o.scheduled_delivery_date ? String(o.scheduled_delivery_date).slice(0, 10) : '';
    const derived = orderIdToMealType.get(o.id) ?? (orderIdUnclassified.has(o.id) ? '__any_meal__' : null);
    if (!derived) continue;
    const key = clientDateKey(effectiveClientId(o.client_id), dateStr);
    if (!existingByClientDate.has(key)) existingByClientDate.set(key, []);
    existingByClientDate.get(key)!.push({ orderId: o.id, mealType: derived });
  }
  const expectedMealByClientDate = new Map<string, ExpectedOrder[]>();
  for (const exp of expectedOrders) {
    if (exp.service_type !== 'Meal' || !exp.mealType) continue;
    const key = clientDateKey(exp.client_id, exp.scheduled_delivery_date);
    if (!expectedMealByClientDate.has(key)) expectedMealByClientDate.set(key, []);
    expectedMealByClientDate.get(key)!.push(exp);
  }
  const matched = new Set<ExpectedOrder>();
  const matchedToOrderId = new Map<ExpectedOrder, string>();
  for (const [, expectedList] of expectedMealByClientDate) {
    const key = expectedList[0] ? clientDateKey(expectedList[0].client_id, expectedList[0].scheduled_delivery_date) : '';
    const existingList = existingByClientDate.get(key) || [];
    for (const ex of existingList) {
      const canonical = ex.mealType === '__any_meal__' ? null : (ex.mealType || '').trim();
      const canonicalLower = canonical ? norm(canonical) : '';
      let idx = canonicalLower
        ? expectedList.findIndex((e) => !matched.has(e) && norm(e.mealTypeCanonical || '') === canonicalLower)
        : -1;
      if (idx < 0) idx = expectedList.findIndex((e) => !matched.has(e));
      if (idx >= 0) {
        const exp = expectedList[idx];
        matched.add(exp);
        matchedToOrderId.set(exp, ex.orderId);
      }
    }
  }

  // Match non-Meal expected orders to existing orders so existingOrderNumber is set
  for (const exp of expectedOrders) {
    if (exp.service_type === 'Meal' && exp.mealType) continue; // already matched above
    if (exp.service_type === 'Boxes') {
      const key = `${exp.client_id}|Boxes`;
      const orderId = existingKeyToOrderId.get(key);
      if (orderId) matchedToOrderId.set(exp, orderId);
      continue;
    }
    const key = `${exp.client_id}|${exp.scheduled_delivery_date}|${exp.service_type}|${exp.vendor_id}`;
    const orderId = existingKeyToOrderId.get(key);
    if (orderId) matchedToOrderId.set(exp, orderId);
  }

  // Same-week matching for Food: expected on one day can match existing on another day (same client + vendor in week)
  const matchedOrderIdsSoFar = new Set(matchedToOrderId.values());
  const unmatchedExpectedFood = expectedOrders.filter(
    (exp) => exp.service_type === 'Food' && !matchedToOrderId.has(exp)
  );
  const unmatchedExistingFoodByClientVendor = new Map<string, { orderId: string; o: any }[]>();
  for (const o of ordersList) {
    if (o.service_type !== 'Food' || matchedOrderIdsSoFar.has(o.id)) continue;
    const eff = effectiveClientId(o.client_id);
    const vsList = vsByOrderId.get(o.id) || [];
    for (const vs of vsList) {
      const k = `${eff}|${vs.vendor_id}`;
      if (!unmatchedExistingFoodByClientVendor.has(k)) unmatchedExistingFoodByClientVendor.set(k, []);
      unmatchedExistingFoodByClientVendor.get(k)!.push({ orderId: o.id, o });
      break;
    }
  }
  for (const exp of unmatchedExpectedFood) {
    const k = `${exp.client_id}|${exp.vendor_id}`;
    const pool = unmatchedExistingFoodByClientVendor.get(k);
    if (!pool || pool.length === 0) continue;
    const chosen = pool.shift()!;
    matchedToOrderId.set(exp, chosen.orderId);
    matchedOrderIdsSoFar.add(chosen.orderId);
  }

  const missing: ExpectedOrder[] = [];
  for (const exp of expectedOrders) {
    if (exp.service_type === 'Boxes') {
      const count = existingKeyCount.get(`${exp.client_id}|Boxes`) || 0;
      if (count > 0) continue;
    }
    if (exp.service_type === 'Meal' && exp.mealType) {
      if (matched.has(exp)) continue;
      missing.push(exp);
      continue;
    }
    if (exp.service_type !== 'Meal') {
      const key = `${exp.client_id}|${exp.scheduled_delivery_date}|${exp.service_type}|${exp.vendor_id}`;
      const count = existingKeyCount.get(key) || 0;
      if (count > 0) continue;
    }
    missing.push(exp);
  }

  const orderById = new Map(ordersList.map((o: any) => [o.id, o]));
  type ExpectedWithOrderNumber = ExpectedOrder & { existingOrderNumber: number | null };
  const expectedWithDetails: ExpectedWithOrderNumber[] = expectedOrders.map((exp) => {
    const orderId = matchedToOrderId.get(exp);
    const existingOrderNumber = orderId ? (orderIdToOrderNumber.get(orderId) ?? null) : null;
    const matchedOrder = orderId ? orderById.get(orderId) : null;
    const totalValue = matchedOrder?.total_value != null ? Number(matchedOrder.total_value) : exp.payload.totalValue;
    const totalItems = matchedOrder?.total_items != null ? Number(matchedOrder.total_items) : exp.payload.totalItems;
    return {
      ...exp,
      existingOrderNumber,
      payload: { ...exp.payload, totalValue, totalItems }
    };
  });

  const matchedOrderIds = new Set(matchedToOrderId.values());
  type ExistingOrderRow = { orderId: string; order_number: number; scheduled_delivery_date: string; vendorName: string; mealType: string; status: 'matched' | 'extra'; total_items?: number | null; total_value?: number | null };
  const existingOrdersByClient: Record<string, ExistingOrderRow[]> = {};
  const clientIdSet = options?.clientIds?.length ? new Set(options.clientIds) : null;
  for (const o of ordersList) {
    const eff = effectiveClientId(o.client_id);
    if (clientIdSet && !clientIdSet.has(eff)) continue;
    const dateStr = o.scheduled_delivery_date ? String(o.scheduled_delivery_date).slice(0, 10) : '';
    const vs = vsByOrderId.get(o.id);
    const vendorName = vs?.length ? (vendorMap.get(vs[0].vendor_id)?.name ?? '') : '';
    const mealType = o.service_type === 'Meal' ? (orderIdToMealType.get(o.id) ?? o.service_type) : o.service_type;
    if (!existingOrdersByClient[eff]) existingOrdersByClient[eff] = [];
    existingOrdersByClient[eff].push({
      orderId: o.id,
      order_number: orderIdToOrderNumber.get(o.id) ?? 0,
      scheduled_delivery_date: dateStr,
      vendorName,
      mealType,
      status: matchedOrderIds.has(o.id) ? 'matched' : 'extra',
      total_items: o.total_items ?? null,
      total_value: o.total_value ?? null
    });
  }

  return {
    missing,
    expectedCount: expectedOrders.length,
    cutoffUsedAt,
    cutoffDayName,
    clientSnapshotUsedAt,
    expectedWithDetails,
    snapshotOrderConfig,
    existingOrdersByClient
  };
}
