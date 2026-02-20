/**
 * Debug why a specific order didn't match in the backfill script.
 * Usage: npx tsx scripts/debug-backfill-order-match.ts c0b928dc-db7d-474d-a7fc-88a09370b744
 *        npx tsx scripts/debug-backfill-order-match.ts c0b928dc-db7d-474d-a7fc-88a09370b744 --week=2026-02-24
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey || !supabaseUrl) {
  console.error('Missing env. Use .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const orderId = process.argv[2];
const weekArg = process.argv.find((a) => a.startsWith('--week='));
const weekStr = weekArg ? weekArg.split('=')[1] : '2026-02-24';

if (!orderId) {
  console.error('Usage: npx tsx scripts/debug-backfill-order-match.ts <order-id> [--week=YYYY-MM-DD]');
  process.exit(1);
}

async function main() {
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, client_id, scheduled_delivery_date, service_type, order_number')
    .eq('id', orderId)
    .single();

  if (orderErr || !order) {
    console.error('Order not found:', orderId, orderErr?.message);
    process.exit(1);
  }

  console.log('--- Order ---');
  console.log('id:', order.id);
  console.log('client_id:', order.client_id, '(type:', typeof order.client_id + ')');
  console.log('scheduled_delivery_date:', order.scheduled_delivery_date, '(raw type:', typeof order.scheduled_delivery_date + ')');
  const dateStr = order.scheduled_delivery_date ? String(order.scheduled_delivery_date).slice(0, 10) : '';
  console.log('dateStr (first 10):', dateStr);
  console.log('service_type:', order.service_type);
  console.log('order_number:', order.order_number);

  const weekStart = new Date(weekStr + 'T00:00:00');
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const weekEndStr = weekEnd.toISOString().split('T')[0];
  console.log('\n--- Backfill week ---');
  console.log('weekStartStr:', weekStartStr, 'weekEndStr:', weekEndStr);
  const inRange = dateStr >= weekStartStr && dateStr <= weekEndStr;
  console.log('Order date in range?', inRange, inRange ? '' : '-> ORDER WOULD BE EXCLUDED (outside week range)');

  const { data: vsList } = await supabase
    .from('order_vendor_selections')
    .select('order_id, vendor_id')
    .eq('order_id', orderId);
  console.log('\n--- Vendor selection(s) ---');
  console.log(vsList || []);

  const { data: items } = await supabase
    .from('order_items')
    .select('id, order_id, menu_item_id, meal_item_id, quantity')
    .eq('order_id', orderId);
  console.log('\n--- Order items ---');
  console.log(items || []);

  const mealItemIds = (items || []).map((i: any) => i.meal_item_id).filter(Boolean);
  const menuItemIds = (items || []).map((i: any) => i.menu_item_id).filter(Boolean);
  console.log('meal_item_ids:', mealItemIds.length ? mealItemIds : '(none)');
  console.log('menu_item_ids:', menuItemIds.length ? menuItemIds : '(none)');
  if (mealItemIds.length === 0 && menuItemIds.length > 0) {
    console.log('-> Order has menu_item_id but NO meal_item_id. Backfill only derives meal_type from meal_item_id!');
  }

  const { data: breakfastCategories } = await supabase.from('breakfast_categories').select('id, meal_type');
  const categoryIdToMealType = new Map((breakfastCategories || []).map((c: any) => [c.id, c.meal_type]));

  const { data: breakfastItems } = await supabase.from('breakfast_items').select('id, category_id');
  const mealItemIdToMealType = new Map(
    (breakfastItems || []).map((i: any) => [i.id, categoryIdToMealType.get(i.category_id) || 'Lunch'])
  );
  const { data: itemCategories } = await supabase.from('item_categories').select('id, name');
  const itemCategoryIdToMealType = new Map((itemCategories || []).map((c: any) => [c.id, (c as any).meal_type || 'Lunch']));
  const { data: menuItems } = await supabase.from('menu_items').select('id, category_id');
  const menuItemIdToMealType = new Map(
    (menuItems || []).map((i: any) => [i.id, itemCategoryIdToMealType.get(i.category_id) || 'Lunch'])
  );

  const mealTypesFromItems = new Set<string>();
  for (const mid of mealItemIds) {
    const mt = mealItemIdToMealType.get(mid);
    if (mt) mealTypesFromItems.add(mt);
  }
  for (const mid of menuItemIds) {
    const mt = menuItemIdToMealType.get(mid);
    if (mt) mealTypesFromItems.add(mt);
  }
  const derivedMealType = mealTypesFromItems.size > 0 ? [...mealTypesFromItems].sort()[0] : null;
  console.log('\n--- Derived meal_type (from meal_item_id -> breakfast_items -> breakfast_categories) ---');
  console.log('derivedMealType:', derivedMealType ?? '(none - order would NOT be counted as existing for any meal type)');

  console.log('\n--- Key backfill would use for EXISTING ---');
  const existingKeys: string[] = [];
  if (order.service_type === 'Meal' && derivedMealType && (vsList || []).length > 0) {
    for (const vs of vsList || []) {
      const key = `${order.client_id}|${dateStr}|Meal|${vs.vendor_id}|${derivedMealType}`;
      existingKeys.push(key);
    }
  }
  console.log(existingKeys.length ? existingKeys : '(none - missing meal_type or vendor)');

  console.log('\n--- Expected keys for this client (from upcoming_order / order_history snapshot) ---');
  const { data: client } = await supabase
    .from('clients')
    .select('id, full_name, upcoming_order, order_history')
    .eq('id', order.client_id)
    .single();
  if (!client) {
    console.log('Client not found');
    return;
  }
  const uo = (client as any).upcoming_order;
  const mealSel = uo?.mealSelections ?? uo?.meal_selections;
  if (!mealSel || typeof mealSel !== 'object') {
    console.log('No mealSelections in upcoming_order');
    return;
  }
  const { getFirstDeliveryDateInWeek } = await import('../lib/order-dates');
  const { data: vendors } = await supabase.from('vendors').select('id, name, delivery_days');
  const vendorMap = new Map((vendors || []).map((v: any) => [v.id, v]));
  function normalizeMealType(key: string): string {
    const idx = key.indexOf('_');
    return idx > 0 ? key.slice(0, idx) : key;
  }
  const expectedKeys: string[] = [];
  for (const [mealTypeKey, group] of Object.entries(mealSel)) {
    const g = group as any;
    const vid = g?.vendorId ?? g?.vendor_id;
    if (!vid) continue;
    const vendor = vendorMap.get(vid);
    if (!vendor) continue;
    const deliveryDate = getFirstDeliveryDateInWeek(weekStart, vendor.delivery_days || []);
    if (!deliveryDate) continue;
    const edateStr = deliveryDate.toISOString().split('T')[0];
    if (edateStr < weekStartStr || edateStr > weekEndStr) continue;
    const mt = normalizeMealType(mealTypeKey);
    expectedKeys.push(`${order.client_id}|${edateStr}|Meal|${vid}|${mt}`);
  }
  console.log(expectedKeys.length ? expectedKeys : '(none in this week)');

  console.log('\n--- Match check ---');
  const matched = existingKeys.some((ek) => expectedKeys.includes(ek));
  console.log('Any existing key in expected?', matched);
  if (!matched && existingKeys.length && expectedKeys.length) {
    console.log('Mismatch details:');
    console.log('  Existing:', existingKeys);
    console.log('  Expected:', expectedKeys);
    existingKeys.forEach((ek, i) => {
      expectedKeys.forEach((exp, j) => {
        const [ec, ed, _, ev, em] = ek.split('|');
        const [xc, xd, __, xv, xm] = exp.split('|');
        if (ek !== exp) {
          const diffs = [];
          if (ec !== xc) diffs.push('client_id');
          if (ed !== xd) diffs.push('date');
          if (ev !== xv) diffs.push('vendor_id');
          if (em !== xm) diffs.push('meal_type');
          if (diffs.length < 4) console.log('    Diff:', diffs.join(', '), '| existing:', ek, '| expected:', exp);
        }
      });
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
