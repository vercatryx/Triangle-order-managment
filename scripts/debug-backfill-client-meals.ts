/**
 * Debug why a client's meal selections (e.g. 3 meals in profile) are not all
 * detected as expected / missing by the backfill.
 *
 * Run against DB (uses .env.local):
 *   npx tsx scripts/debug-backfill-client-meals.ts --client-name="CHAYA GLAUBER" --week=2026-02-24
 *   npx tsx scripts/debug-backfill-client-meals.ts --client-name="CHAYA GLAUBER" --week=2026-02-24 --cutoff=2026-02-18T00:00:00
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { getFirstDeliveryDateInWeek } from '../lib/order-dates';
import { getWeekStart } from '../lib/weekly-lock';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey || !supabaseUrl) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1]?.trim() : undefined;
};
const clientNameArg = getArg('client-name');
const weekArg = getArg('week') ?? '2026-02-24';
const cutoffArg = getArg('cutoff');

if (!clientNameArg) {
  console.error('Usage: npx tsx scripts/debug-backfill-client-meals.ts --client-name="CHAYA GLAUBER" [--week=YYYY-MM-DD] [--cutoff=ISO]');
  process.exit(1);
}

function normalizeMealType(key: string): string {
  const idx = key.indexOf('_');
  return idx > 0 ? key.slice(0, idx) : key;
}

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
  const weekStart = getWeekStart(new Date(weekArg + 'T00:00:00'));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const weekEndStr = weekEnd.toISOString().split('T')[0];
  const weekStartDate = new Date(weekStartStr + 'T00:00:00');

  console.log('=== Backfill meal diagnostic ===');
  console.log('Client name (search):', clientNameArg);
  console.log('Week:', weekStartStr, 'to', weekEndStr);

  // Resolve client by name (case-insensitive, partial match)
  const { data: clients, error: clientErr } = await supabase
    .from('clients')
    .select('id, full_name, status_id, expiration_date, order_history, upcoming_order')
    .ilike('full_name', `%${clientNameArg}%`)
    .is('parent_client_id', null);

  if (clientErr || !clients?.length) {
    console.error('Client not found or error:', clientErr?.message || 'no rows');
    process.exit(1);
  }
  if (clients.length > 1) {
    console.log('Multiple clients matched; using first:', clients.map((c: any) => c.full_name));
  }
  const client = clients[0] as any;
  const clientId = client.id;
  console.log('Client id:', clientId, '| full_name:', client.full_name);

  // Cutoff
  let cutoffDate: Date;
  if (cutoffArg) {
    cutoffDate = new Date(cutoffArg);
  } else {
    const { data: settings } = await supabase.from('app_settings').select('weekly_cutoff_day, weekly_cutoff_time').single();
    const dayName = (settings as any)?.weekly_cutoff_day || 'Tuesday';
    const timeStr = (settings as any)?.weekly_cutoff_time || '00:00';
    const [h, m] = timeStr.split(':').map(Number);
    const weekBefore = new Date(weekStart);
    weekBefore.setDate(weekStart.getDate() - 7);
    const DAY_NAME_TO_NUMBER: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    const dayNum = DAY_NAME_TO_NUMBER[dayName] ?? 2;
    cutoffDate = new Date(weekBefore);
    cutoffDate.setDate(weekBefore.getDate() + dayNum);
    cutoffDate.setHours(h || 0, m || 0, 0, 0);
  }
  console.log('Cutoff used:', cutoffDate.toISOString());
  const updatedAfter = clientUpdatedAfterCutoff(client.order_history || [], cutoffDate);
  const snapshotAt = snapshotAtCutoff(client.order_history || [], cutoffDate);
  console.log('Updated after cutoff?', updatedAfter);
  console.log('Has snapshot at cutoff?', !!snapshotAt);

  const uo = (updatedAfter ? snapshotAt : client.upcoming_order ?? snapshotAt) as any;
  if (!uo || typeof uo !== 'object') {
    console.log('No upcoming_order / snapshot -> no expected meals. EXIT.');
    process.exit(0);
  }

  const st = uo.serviceType ?? uo.service_type;
  const mealSel = uo.mealSelections ?? uo.meal_selections;
  console.log('Source serviceType:', st);
  console.log('mealSelections keys:', mealSel && typeof mealSel === 'object' ? Object.keys(mealSel) : '(none or not object)');

  // Load vendors and categories (same as backfill)
  const [vendorsRes, breakfastCatRes, itemCatRes, menuItemsRes, mealItemsRes] = await Promise.all([
    supabase.from('vendors').select('id, name, delivery_days, is_active'),
    supabase.from('breakfast_categories').select('id, name, meal_type, is_active'),
    supabase.from('item_categories').select('id, name, meal_type, is_active'),
    supabase.from('menu_items').select('id, vendor_id, value, price_each, is_active, category_id'),
    supabase.from('breakfast_items').select('id, category_id, price_each, is_active, vendor_id')
  ]);

  const allVendors = (vendorsRes.data || []) as { id: string; name: string; delivery_days?: string[]; is_active?: boolean }[];
  const allBreakfastCategories = (breakfastCatRes.data || []) as { id: string; name?: string; meal_type: string; is_active?: boolean }[];
  const allItemCategories = (itemCatRes.data || []) as { id: string; name?: string; meal_type?: string; is_active?: boolean }[];
  const allMenuItems = (menuItemsRes.data || []) as any[];
  const allMealItems = ((mealItemsRes.data || []) as any[]).map((i) => ({ ...i, itemType: 'meal' as const }));

  const vendorMap = new Map(allVendors.map((v) => [v.id, { ...v, deliveryDays: v.delivery_days || [] }]));
  const vendorActiveMap = new Map<string, boolean>(allVendors.map((v) => [v.id, !!v.is_active]));

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

  const activeMealTypes = new Set<string>();
  for (const c of allBreakfastCategories) {
    if (c.is_active !== false) activeMealTypes.add(c.meal_type || 'Lunch');
  }
  for (const c of allItemCategories) {
    const mt = (c as any).meal_type;
    if (mt && (c as any).is_active !== false) activeMealTypes.add(mt);
  }
  console.log('Active meal types (from categories):', [...activeMealTypes].sort());

  type Expected = { mealType: string; mealTypeCanonical: string; vendor_id: string; vendorName: string; dateStr: string; itemsCount: number };
  const expectedList: Expected[] = [];

  if ((st === 'Food' || st === 'Meal') && mealSel && typeof mealSel === 'object') {
    for (const [_mealType, group] of Object.entries(mealSel)) {
      const g = group as { vendorId?: string; vendor_id?: string; items?: Record<string, number>; itemNotes?: Record<string, string> };
      const vid = g?.vendorId ?? g?.vendor_id;
      const reasons: string[] = [];
      if (!vid) {
        reasons.push('no vendorId/vendor_id');
        console.log(`  [${_mealType}] SKIP: ${reasons.join('; ')}`);
        continue;
      }
      const vendor = vendorMap.get(vid);
      if (!vendor) {
        reasons.push('vendor not in DB');
        console.log(`  [${_mealType}] SKIP: ${reasons.join('; ')}`);
        continue;
      }
      if (vendorActiveMap.get(vid) === false) {
        reasons.push('vendor inactive');
        console.log(`  [${_mealType}] SKIP: ${reasons.join('; ')}`);
        continue;
      }
      const deliveryDate = getFirstDeliveryDateInWeek(weekStartDate, vendor.deliveryDays);
      if (!deliveryDate) {
        reasons.push('no delivery day in week for vendor');
        console.log(`  [${_mealType}] SKIP: ${reasons.join('; ')}`);
        continue;
      }
      const dateStr = deliveryDate.toISOString().split('T')[0];
      if (dateStr < weekStartStr || dateStr > weekEndStr) {
        reasons.push(`date ${dateStr} outside week`);
        console.log(`  [${_mealType}] SKIP: ${reasons.join('; ')}`);
        continue;
      }
      let itemsCount = 0;
      if (g.items) {
        for (const [itemId, qty] of Object.entries(g.items)) {
          if (Number(qty) <= 0) continue;
          const mItem = allMealItems.find((i: any) => i.id === itemId) || allMenuItems.find((i: any) => i.id === itemId);
          if (mItem) itemsCount += 1;
        }
      }
      if (itemsCount === 0) {
        reasons.push('no valid items (or items not in menu_items/breakfast_items)');
        console.log(`  [${_mealType}] SKIP: ${reasons.join('; ')}`);
        continue;
      }
      const mealTypeCanonical = categoryNameOrTypeToCanonicalMealType.get(_mealType) ?? categoryNameOrTypeToCanonicalMealType.get(normalizeMealType(_mealType)) ?? normalizeMealType(_mealType);
      if (!activeMealTypes.has(mealTypeCanonical)) {
        reasons.push(`meal type "${mealTypeCanonical}" is deactivated (no active category)`);
        console.log(`  [${_mealType}] SKIP: ${reasons.join('; ')}`);
        continue;
      }
      console.log(`  [${_mealType}] ADDED -> canonical=${mealTypeCanonical} vendor=${vendor.name} date=${dateStr} items=${itemsCount}`);
      expectedList.push({
        mealType: _mealType,
        mealTypeCanonical,
        vendor_id: vid,
        vendorName: vendor.name,
        dateStr,
        itemsCount
      });
    }
  }

  console.log('\n--- Expected meal orders (count):', expectedList.length);

  // Existing orders for this client in week
  const { data: ordersList } = await supabase
    .from('orders')
    .select('id, client_id, scheduled_delivery_date, service_type')
    .eq('client_id', clientId)
    .gte('scheduled_delivery_date', weekStartStr)
    .lte('scheduled_delivery_date', weekEndStr);

  const orders = (ordersList || []) as any[];
  const mealOrders = orders.filter((o: any) => o.service_type === 'Meal');
  console.log('--- Existing orders in week (all):', orders.length, '| Meal:', mealOrders.length);

  if (mealOrders.length > 0) {
    const orderIds = mealOrders.map((o: any) => o.id);
    const { data: vsData } = await supabase.from('order_vendor_selections').select('order_id, vendor_id').in('order_id', orderIds);
    const { data: itemsData } = await supabase.from('order_items').select('order_id, meal_item_id, menu_item_id').in('order_id', orderIds);
    const vsByOrderId = new Map<string, { vendor_id: string }[]>();
    for (const vs of vsData || []) {
      const v = vs as { order_id: string; vendor_id: string };
      if (!vsByOrderId.has(v.order_id)) vsByOrderId.set(v.order_id, []);
      vsByOrderId.get(v.order_id)!.push({ vendor_id: v.vendor_id });
    }
    const orderIdToMealType = new Map<string, string>();
    for (const row of itemsData || []) {
      const r = row as { order_id: string; meal_item_id: string | null; menu_item_id: string | null };
      let mt: string | undefined;
      if (r.meal_item_id) mt = mealItemIdToMealType.get(r.meal_item_id);
      if (mt == null && r.menu_item_id) mt = menuItemIdToMealType.get(r.menu_item_id);
      if (mt) {
        if (!orderIdToMealType.has(r.order_id)) orderIdToMealType.set(r.order_id, mt);
      }
    }
    const slotKey = (c: string, d: string, v: string) => `${c}|${d}|Meal|${v}`;
    const existingBySlot = new Map<string, { orderId: string; mealType: string }[]>();
    for (const o of mealOrders) {
      const dateStr = String(o.scheduled_delivery_date).slice(0, 10);
      const derived = orderIdToMealType.get(o.id) ?? '(unclassified)';
      for (const vs of vsByOrderId.get(o.id) || []) {
        const key = slotKey(o.client_id, dateStr, vs.vendor_id);
        if (!existingBySlot.has(key)) existingBySlot.set(key, []);
        existingBySlot.get(key)!.push({ orderId: o.id, mealType: derived });
      }
    }
    const expectedBySlot = new Map<string, Expected[]>();
    for (const exp of expectedList) {
      const key = slotKey(clientId, exp.dateStr, exp.vendor_id);
      if (!expectedBySlot.has(key)) expectedBySlot.set(key, []);
      expectedBySlot.get(key)!.push(exp);
    }
    console.log('\n--- Slot-level comparison ---');
    for (const [key, existingList] of existingBySlot) {
      const expectedInSlot = expectedBySlot.get(key) || [];
      console.log('Slot:', key);
      console.log('  Existing:', existingList.length, existingList.map((x) => `${x.mealType}`));
      console.log('  Expected:', expectedInSlot.length, expectedInSlot.map((x) => x.mealTypeCanonical));
    }
    for (const [key, expectedInSlot] of expectedBySlot) {
      if (existingBySlot.has(key)) continue;
      console.log('Slot (expected only, no existing):', key, '->', expectedInSlot.map((x) => x.mealTypeCanonical));
    }
    // Matching: which expected are satisfied by which existing
    const matchedExpected = new Set<Expected>();
    for (const [key, expectedInSlot] of expectedBySlot) {
      const existingList = existingBySlot.get(key) || [];
      for (const ex of existingList) {
        const canonical = ex.mealType === '(unclassified)' ? null : ex.mealType;
        let idx = canonical != null ? expectedInSlot.findIndex((e) => !matchedExpected.has(e) && e.mealTypeCanonical === canonical) : -1;
        if (idx < 0) idx = expectedInSlot.findIndex((e) => !matchedExpected.has(e));
        if (idx >= 0) matchedExpected.add(expectedInSlot[idx]);
      }
    }
    const missingExpected = expectedList.filter((e) => !matchedExpected.has(e));
    console.log('\n--- Missing (expected but no matching existing):', missingExpected.length);
    missingExpected.forEach((e) => console.log('  -', e.mealTypeCanonical, e.vendorName, e.dateStr));
  } else {
    const missingExpected = expectedList;
    console.log('\n--- Missing (all expected, no existing Meal orders):', missingExpected.length);
    missingExpected.forEach((e) => console.log('  -', e.mealTypeCanonical, e.vendorName, e.dateStr));
  }

  console.log('\n=== Done ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
