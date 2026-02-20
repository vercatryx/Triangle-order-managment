/**
 * Backfill missing Meal orders only for a delivery week using each client's order_history
 * snapshot at cutoff (so post-cutoff changes don't affect the backfill).
 * Does not touch Food, Boxes, or Custom orders.
 *
 * Run (examples):
 *   npx tsx scripts/backfill-orders-from-history.ts --week-start=2026-02-23 --week-end=2026-03-01 --cutoff=2026-02-18T00:00:00
 *   npx tsx scripts/backfill-orders-from-history.ts --week=2026-02-24 --cutoff=2026-02-18T00:00:00 --client=CLIENT-1458 --dry-run
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { getFirstDeliveryDateInWeek, DAY_NAME_TO_NUMBER } from '../lib/order-dates';
import { getWeekStart } from '../lib/weekly-lock';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey || !supabaseUrl) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1]?.trim() : undefined;
};
const DRY_RUN = args.includes('--dry-run');
const weekStartArg = getArg('week-start');
const weekEndArg = getArg('week-end');
const weekArg = getArg('week');
const cutoffArg = getArg('cutoff');
const clientArg = getArg('client');

let weekStartStr: string;
let weekEndStr: string;
if (weekStartArg && weekEndArg) {
  weekStartStr = weekStartArg;
  weekEndStr = weekEndArg;
} else if (weekArg) {
  const d = new Date(weekArg);
  if (isNaN(d.getTime())) {
    console.error('Invalid --week= date');
    process.exit(1);
  }
  const start = getWeekStart(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  weekStartStr = start.toISOString().split('T')[0];
  weekEndStr = end.toISOString().split('T')[0];
} else {
  console.error('Provide --week-start and --week-end, or --week=YYYY-MM-DD');
  process.exit(1);
}

const weekStartDate = new Date(weekStartStr + 'T00:00:00');

/** Normalize meal type key (e.g. "Breakfast_123" -> "Breakfast") for matching. */
function normalizeMealType(key: string): string {
  const idx = key.indexOf('_');
  return idx > 0 ? key.slice(0, idx) : key;
}

type ExpectedOrder = {
  client_id: string;
  clientName: string;
  scheduled_delivery_date: string;
  service_type: 'Food' | 'Meal' | 'Boxes' | 'Custom';
  vendor_id: string;
  vendorName: string;
  /** Meal only: raw key from mealSelections (e.g. "Triangle Breakfast/Lunch (9 Meals)"). */
  mealType?: string;
  /** Canonical meal type for matching to existing (e.g. "Lunch"). */
  mealTypeCanonical?: string;
  payload: {
    totalValue: number;
    totalItems: number;
    notes: string | null;
    case_id: string | undefined;
    itemsList?: { menu_item_id: string; quantity: number; unit_value: number; total_value: number; notes: string | null }[];
    boxSelections?: { vendor_id: string; box_type_id: string | null; quantity: number; unit_value: number; total_value: number; items: any; item_notes?: any }[];
    customNames?: string[];
    customTotalValue?: number;
  };
};

function snapshotAtCutoff(orderHistory: any[], cutoff: Date): Record<string, unknown> | null {
  const upcoming = (orderHistory || []).filter(
    (e: any) => e?.type === 'upcoming' && (e.orderData != null || e.order_data != null)
  );
  const atOrBefore = upcoming.filter((e: any) => {
    const t = e.timestamp || e.created_at;
    return t && new Date(t) <= cutoff;
  });
  if (atOrBefore.length === 0) return null;
  atOrBefore.sort((a: any, b: any) => new Date(b.timestamp || b.created_at).getTime() - new Date(a.timestamp || a.created_at).getTime());
  const entry = atOrBefore[0];
  return entry.orderData ?? entry.order_data ?? null;
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

async function main() {
  let cutoffDate: Date;
  if (cutoffArg) {
    cutoffDate = new Date(cutoffArg);
    if (isNaN(cutoffDate.getTime())) {
      console.error('Invalid --cutoff= ISO datetime');
      process.exit(1);
    }
  } else {
    const { data: settings } = await supabase.from('app_settings').select('weekly_cutoff_day, weekly_cutoff_time').single();
    const dayName = (settings as any)?.weekly_cutoff_day || 'Tuesday';
    const timeStr = (settings as any)?.weekly_cutoff_time || '00:00';
    const [h, m] = timeStr.split(':').map(Number);
    const weekStart = new Date(weekStartStr + 'T00:00:00');
    const weekBefore = new Date(weekStart);
    weekBefore.setDate(weekStart.getDate() - 7);
    const dayNum = (DAY_NAME_TO_NUMBER as Record<string, number>)[dayName] ?? 2;
    cutoffDate = new Date(weekBefore);
    cutoffDate.setDate(weekBefore.getDate() + dayNum);
    cutoffDate.setHours(h || 0, m || 0, 0, 0);
  }

  console.log(`Backfill orders for week ${weekStartStr} to ${weekEndStr}`);
  console.log(`Cutoff: ${cutoffDate.toISOString()}`);
  if (clientArg) console.log(`Client filter: ${clientArg}`);
  if (DRY_RUN) console.log('DRY RUN - no inserts');

  const [vendorsRes, statusesRes, menuItemsRes, mealItemsRes, boxTypesRes, breakfastCategoriesRes, itemCategoriesRes] = await Promise.all([
    supabase.from('vendors').select('id, name, delivery_days, is_active'),
    supabase.from('client_statuses').select('id, name, deliveries_allowed'),
    supabase.from('menu_items').select('id, vendor_id, value, price_each, is_active, category_id'),
    supabase.from('breakfast_items').select('id, category_id, price_each, is_active, vendor_id'),
    supabase.from('box_types').select('id, name'),
    supabase.from('breakfast_categories').select('id, name, meal_type'),
    supabase.from('item_categories').select('id, name')
  ]);

  const allVendors = (vendorsRes.data || []) as { id: string; name: string; delivery_days?: string[]; is_active?: boolean }[];
  const allStatuses = (statusesRes.data || []) as { id: string; name: string; deliveries_allowed?: boolean }[];
  const allMenuItems = (menuItemsRes.data || []) as any[];
  const allMealItems = ((mealItemsRes.data || []) as any[]).map((i) => ({ ...i, itemType: 'meal' as const }));
  const allBoxTypes = (boxTypesRes.data || []) as any[];
  const allBreakfastCategories = (breakfastCategoriesRes.data || []) as { id: string; name?: string; meal_type: string }[];
  const allItemCategories = (itemCategoriesRes.data || []) as { id: string; name?: string; meal_type?: string }[];

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
  /** Map category name or meal_type to canonical meal_type for normalizing expected keys */
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
  const menuItemMap = new Map(allMenuItems.map((i) => [i.id, i]));
  const mealItemMap = new Map(allMealItems.map((i) => [i.id, i]));

  let clients: any[];
  if (clientArg) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, full_name, status_id, expiration_date, order_history, upcoming_order')
      .eq('id', clientArg)
      .is('parent_client_id', null);
    if (error || !data?.length) {
      console.error('Client not found or not a parent:', clientArg);
      process.exit(1);
    }
    clients = data;
  } else {
    const { data, error } = await supabase
      .from('clients')
      .select('id, full_name, status_id, expiration_date, order_history, upcoming_order')
      .is('parent_client_id', null);
    if (error) {
      console.error('Error fetching clients:', error);
      process.exit(1);
    }
    clients = data || [];
  }

  const clientMap = new Map(clients.map((c: any) => [c.id, c]));
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
    const snapshotAt = snapshotAtCutoff(client.order_history || [], cutoffDate);
    const uo = (updatedAfter ? snapshotAt : client.upcoming_order ?? snapshotAt) as any;
    if (!uo || typeof uo !== 'object') continue;
    if (updatedAfter && !snapshotAt) continue;

    const st = uo.serviceType ?? uo.service_type;
    const clientName = client.full_name || client.id;

    // Meal only (script only touches Meal orders)
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
  }

  const expectedOrdersFinal = expectedOrders;

  // Load existing orders in week; for Meal, key by (client, date, vendor, meal_type) using items
  let ordersList: any[] = [];
  if (clientArg) {
    const { data } = await supabase
      .from('orders')
      .select('id, client_id, scheduled_delivery_date, service_type')
      .eq('client_id', clientArg)
      .gte('scheduled_delivery_date', weekStartStr)
      .lte('scheduled_delivery_date', weekEndStr);
    ordersList = data || [];
  } else {
    const { data } = await supabase
      .from('orders')
      .select('id, client_id, scheduled_delivery_date, service_type')
      .gte('scheduled_delivery_date', weekStartStr)
      .lte('scheduled_delivery_date', weekEndStr);
    ordersList = data || [];
  }
  const existingKeyCount = new Map<string, number>();
  const existingMealCountByClientDateVendor = new Map<string, number>();
  const orderIds = ordersList.map((o: any) => o.id);
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

  const mealOrderIds = ordersList.filter((o: any) => o.service_type === 'Meal').map((o: any) => o.id);
  const orderIdToMealType = new Map<string, string>();
  const orderIdUnclassified = new Set<string>();
  if (mealOrderIds.length > 0) {
    const batchSize = 200;
    let allItems: { order_id: string; meal_item_id: string | null; menu_item_id: string | null }[] = [];
    for (let i = 0; i < mealOrderIds.length; i += batchSize) {
      const batch = mealOrderIds.slice(i, i + batchSize);
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
    for (const oid of mealOrderIds) {
      const types = mealTypesByOrderId.get(oid);
      if (types && types.size > 0) {
        orderIdToMealType.set(oid, [...types].sort()[0]);
      } else {
        orderIdUnclassified.add(oid);
      }
    }
  }

  for (const o of ordersList) {
    if (o.service_type === 'Boxes') {
      const key = `${o.client_id}|Boxes`;
      existingKeyCount.set(key, (existingKeyCount.get(key) || 0) + 1);
      continue;
    }
    if (o.service_type === 'Meal') {
      const dateStr = o.scheduled_delivery_date ? String(o.scheduled_delivery_date).slice(0, 10) : '';
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
          const slotKey = `${o.client_id}|${dateStr}|Meal|${vs.vendor_id}`;
          existingMealCountByClientDateVendor.set(slotKey, (existingMealCountByClientDateVendor.get(slotKey) || 0) + 1);
        }
      }
      continue;
    }
    const keyBase = `${o.client_id}|${o.scheduled_delivery_date}|${o.service_type}|`;
    for (const vs of vsByOrderId.get(o.id) || []) {
      existingKeyCount.set(keyBase + vs.vendor_id, (existingKeyCount.get(keyBase + vs.vendor_id) || 0) + 1);
    }
  }

  const missing: ExpectedOrder[] = [];
  if (expectedOrdersFinal.some((e) => e.service_type === 'Meal')) {
    const slotKey = (c: string, d: string, v: string) => `${c}|${d}|Meal|${v}`;
    const existingBySlot = new Map<string, { orderId: string; mealType: string }[]>();
    for (const o of ordersList) {
      if (o.service_type !== 'Meal') continue;
      const dateStr = o.scheduled_delivery_date ? String(o.scheduled_delivery_date).slice(0, 10) : '';
      const derived = orderIdToMealType.get(o.id) ?? (orderIdUnclassified.has(o.id) ? '__any_meal__' : null);
      if (!derived) continue;
      for (const vs of vsByOrderId.get(o.id) || []) {
        const key = slotKey(o.client_id, dateStr, vs.vendor_id);
        if (!existingBySlot.has(key)) existingBySlot.set(key, []);
        existingBySlot.get(key)!.push({ orderId: o.id, mealType: derived });
      }
    }
    const expectedMealBySlot = new Map<string, ExpectedOrder[]>();
    for (const exp of expectedOrdersFinal) {
      if (exp.service_type !== 'Meal' || !exp.mealType) continue;
      const key = slotKey(exp.client_id, exp.scheduled_delivery_date, exp.vendor_id);
      if (!expectedMealBySlot.has(key)) expectedMealBySlot.set(key, []);
      expectedMealBySlot.get(key)!.push(exp);
    }
    const matched = new Set<ExpectedOrder>();
    for (const [key, expectedList] of expectedMealBySlot) {
      const existingList = existingBySlot.get(key) || [];
      const used = new Set<number>();
      for (const ex of existingList) {
        const canonical = ex.mealType === '__any_meal__' ? null : ex.mealType;
        let idx = canonical != null ? expectedList.findIndex((e) => !matched.has(e) && e.mealTypeCanonical === canonical) : -1;
        if (idx < 0) idx = expectedList.findIndex((e) => !matched.has(e));
        if (idx >= 0) {
          matched.add(expectedList[idx]);
        }
      }
    }
    for (const exp of expectedOrdersFinal) {
      if (exp.service_type === 'Boxes') {
        const key = `${exp.client_id}|Boxes`;
        const count = existingKeyCount.get(key) || 0;
        if (count > 0) {
          existingKeyCount.set(key, count - 1);
          continue;
        }
      }
      if (exp.service_type === 'Meal' && exp.mealType) {
        if (matched.has(exp)) continue;
        missing.push(exp);
        continue;
      }
      if (exp.service_type !== 'Meal') {
        const key = `${exp.client_id}|${exp.scheduled_delivery_date}|${exp.service_type}|${exp.vendor_id}`;
        const count = existingKeyCount.get(key) || 0;
        if (count > 0) {
          existingKeyCount.set(key, count - 1);
          continue;
        }
      }
      missing.push(exp);
    }
  } else {
    for (const exp of expectedOrdersFinal) {
      let key: string;
      if (exp.service_type === 'Boxes') {
        key = `${exp.client_id}|Boxes`;
      } else {
        key = `${exp.client_id}|${exp.scheduled_delivery_date}|${exp.service_type}|${exp.vendor_id}`;
      }
      const count = existingKeyCount.get(key) || 0;
      if (count > 0) {
        existingKeyCount.set(key, count - 1);
        continue;
      }
      missing.push(exp);
    }
  }

  const mealOrdersList = ordersList.filter((o: any) => o.service_type === 'Meal') as { id: string; client_id: string; scheduled_delivery_date: string }[];
  const existingMealDetails = mealOrdersList.map((o: any) => {
    const dateStr = o.scheduled_delivery_date ? String(o.scheduled_delivery_date).slice(0, 10) : '';
    const vs = (vsByOrderId.get(o.id) || [])[0];
    const mealType = orderIdToMealType.get(o.id) ?? (orderIdUnclassified.has(o.id) ? '(unclassified)' : '?');
    return { orderId: o.id, client_id: o.client_id, date: dateStr, vendor_id: vs?.vendor_id ?? '', vendorName: vendorMap.get(vs?.vendor_id ?? '')?.name ?? '', mealType };
  });

  function logByClient(
    label: string,
    items: { client_id: string; clientName?: string; scheduled_delivery_date?: string; vendor_id?: string; vendorName?: string; mealType?: string }[],
    formatter: (x: typeof items[0]) => string
  ) {
    const byClient = new Map<string, typeof items>();
    for (const x of items) {
      const cid = x.client_id;
      if (!byClient.has(cid)) byClient.set(cid, []);
      byClient.get(cid)!.push(x);
    }
    for (const [cid, list] of byClient) {
      const name = list[0]?.clientName ?? cid;
      console.log(`  ${label} (${list.length}): ${name}`);
      list.forEach((x) => console.log(`    - ${formatter(x)}`));
    }
  }

  console.log('');
  console.log('--- Meal orders: expected vs existing vs to create (by comparing meal type / items) ---');
  const expectedMeal = expectedOrdersFinal.filter((e) => e.service_type === 'Meal');
  console.log(`Expected meal orders in week: ${expectedMeal.length}`);
  logByClient('Expected', expectedMeal, (e) => `${e.scheduled_delivery_date} | ${e.vendorName} | mealType: ${e.mealType}`);

  const existingToLog = clientArg ? existingMealDetails.filter((e) => e.client_id === clientArg) : existingMealDetails;
  console.log(`Existing meal orders in week: ${existingMealDetails.length}${clientArg ? ` (showing filtered: ${existingToLog.length} for ${clientArg})` : ''}`);
  const byClientExisting = new Map<string, typeof existingMealDetails>();
  for (const e of existingToLog) {
    if (!byClientExisting.has(e.client_id)) byClientExisting.set(e.client_id, []);
    byClientExisting.get(e.client_id)!.push(e);
  }
  for (const [cid, list] of byClientExisting) {
    const name = expectedMeal.find((e) => e.client_id === cid)?.clientName ?? cid;
    console.log(`  Existing (${list.length}): ${name}`);
    list.forEach((x) => console.log(`    - order ${x.orderId.slice(0, 8)}... | ${x.date} | ${x.vendorName} | derived mealType: ${x.mealType}`));
  }

  console.log(`To create (missing): ${missing.length}`);
  logByClient('Missing', missing, (e) => `${e.scheduled_delivery_date} | ${e.vendorName} | mealType: ${e.mealType}`);

  console.log('');
  console.log(`Summary: expected ${expectedOrdersFinal.length}, existing matched ${expectedOrdersFinal.length - missing.length}, to create ${missing.length}`);

  const excelRows: { 'Client Name': string; Vendor: string; 'Order Number': number }[] = [];
  const now = new Date().toISOString();

  if (missing.length === 0) {
    console.log('No missing orders.');
    const outPath = path.join(process.cwd(), DRY_RUN ? `Backfill_Orders_${weekStartStr}_to_${weekEndStr}_dry_run.xlsx` : `Backfill_Orders_${weekStartStr}_to_${weekEndStr}.xlsx`);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([{ 'Client Name': '-', Vendor: '-', 'Order Number': 0 }]);
    XLSX.utils.book_append_sheet(wb, ws, 'Created');
    const dir = path.dirname(outPath);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    XLSX.writeFile(wb, outPath);
    console.log('Wrote:', outPath);
    return;
  }

  const { data: maxOrder } = await supabase.from('orders').select('order_number').order('order_number', { ascending: false }).limit(1).maybeSingle();
  let nextOrderNumber = Math.max(100000, ((maxOrder as any)?.order_number || 0) + 1);
  const { data: maxCreation } = await supabase.from('orders').select('creation_id').not('creation_id', 'is', null).order('creation_id', { ascending: false }).limit(1).maybeSingle();
  const creationId = ((maxCreation as any)?.creation_id || 0) + 1;

  for (const exp of missing) {
    if (DRY_RUN) {
      excelRows.push({ 'Client Name': exp.clientName, Vendor: exp.vendorName, 'Order Number': nextOrderNumber });
      nextOrderNumber++;
      continue;
    }

    const { data: newOrder, error: orderErr } = await supabase
      .from('orders')
      .insert({
        client_id: exp.client_id,
        service_type: exp.service_type,
        status: 'scheduled',
        scheduled_delivery_date: exp.scheduled_delivery_date,
        total_value: exp.payload.totalValue,
        total_items: exp.payload.totalItems,
        order_number: nextOrderNumber,
        last_updated: now,
        notes: exp.payload.notes,
        case_id: exp.payload.case_id || `CASE-${Date.now()}`,
        creation_id: creationId
      })
      .select()
      .single();

    if (orderErr || !newOrder) {
      console.error(`Failed to create order for ${exp.clientName} (${exp.service_type} ${exp.scheduled_delivery_date}):`, orderErr?.message || orderErr);
      continue;
    }

    excelRows.push({ 'Client Name': exp.clientName, Vendor: exp.vendorName, 'Order Number': nextOrderNumber });
    nextOrderNumber++;

    const { data: vs, error: vsErr } = await supabase
      .from('order_vendor_selections')
      .insert({ order_id: newOrder.id, vendor_id: exp.vendor_id })
      .select()
      .single();

    if (vsErr || !vs) {
      console.error('order_vendor_selections insert failed for order', newOrder.id, vsErr?.message);
      continue;
    }

    // Meal only: insert order_items (meal items use meal_item_id, not menu_item_id)
    const itemsList = exp.payload.itemsList!;
    await supabase.from('order_items').insert(
      itemsList.map((i) => ({
        order_id: newOrder.id,
        vendor_selection_id: vs.id,
        meal_item_id: i.menu_item_id,
        quantity: i.quantity,
        unit_value: i.unit_value,
        total_value: i.total_value,
        notes: i.notes ?? null
      }))
    );
  }

  const outPath = path.join(
    process.cwd(),
    DRY_RUN ? `Backfill_Orders_${weekStartStr}_to_${weekEndStr}_dry_run.xlsx` : `Backfill_Orders_${weekStartStr}_to_${weekEndStr}.xlsx`
  );
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(excelRows.length ? excelRows : [{ 'Client Name': '-', Vendor: '-', 'Order Number': 0 }]);
  XLSX.utils.book_append_sheet(wb, ws, 'Created');
  const dir = path.dirname(outPath);
  if (dir) fs.mkdirSync(dir, { recursive: true });
  XLSX.writeFile(wb, outPath);
  console.log(DRY_RUN ? `Would create ${excelRows.length} orders (dry run).` : `Created ${excelRows.length} orders.`, 'Wrote:', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
