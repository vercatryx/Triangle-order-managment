/**
 * Find why meal selection "items" are reported as invalid (not in menu_items/breakfast_items).
 * Compares item IDs from the client's snapshot to DB tables and reports format/lookup issues.
 *
 * Run (uses .env.local):
 *   npx tsx scripts/debug-meal-selection-item-ids.ts --client-name="CHAYA GLAUBER"
 *   npx tsx scripts/debug-meal-selection-item-ids.ts --client-name="CHAYA GLAUBER" --cutoff=2026-02-18T05:00:00
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

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
const cutoffArg = getArg('cutoff');

if (!clientNameArg) {
  console.error('Usage: npx tsx scripts/debug-meal-selection-item-ids.ts --client-name="CHAYA GLAUBER" [--cutoff=ISO]');
  process.exit(1);
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
  let cutoffDate: Date;
  if (cutoffArg) {
    cutoffDate = new Date(cutoffArg);
  } else {
    const { data: settings } = await supabase.from('app_settings').select('weekly_cutoff_day, weekly_cutoff_time').single();
    const dayName = (settings as any)?.weekly_cutoff_day || 'Tuesday';
    const timeStr = (settings as any)?.weekly_cutoff_time || '00:00';
    const [h, m] = timeStr.split(':').map(Number);
    const weekStart = new Date('2026-02-22T00:00:00'); // week containing 2026-02-24
    const weekBefore = new Date(weekStart);
    weekBefore.setDate(weekStart.getDate() - 7);
    const DAY_NAME_TO_NUMBER: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    const dayNum = DAY_NAME_TO_NUMBER[dayName] ?? 2;
    cutoffDate = new Date(weekBefore);
    cutoffDate.setDate(weekBefore.getDate() + dayNum);
    cutoffDate.setHours(h || 0, m || 0, 0, 0);
  }

  const { data: clients, error: clientErr } = await supabase
    .from('clients')
    .select('id, full_name, order_history, upcoming_order')
    .ilike('full_name', `%${clientNameArg}%`)
    .is('parent_client_id', null);

  if (clientErr || !clients?.length) {
    console.error('Client not found:', clientErr?.message || 'no rows');
    process.exit(1);
  }
  const client = clients[0] as any;
  const updatedAfter = clientUpdatedAfterCutoff(client.order_history || [], cutoffDate);
  const snapshotAt = snapshotAtCutoff(client.order_history || [], cutoffDate);
  const uo = (updatedAfter ? snapshotAt : client.upcoming_order ?? snapshotAt) as any;

  if (!uo || typeof uo !== 'object') {
    console.log('No upcoming_order / snapshot.');
    process.exit(0);
  }

  const mealSel = uo.mealSelections ?? uo.meal_selections;
  if (!mealSel || typeof mealSel !== 'object') {
    console.log('No mealSelections in source.');
    process.exit(0);
  }

  console.log('=== Meal selection item ID diagnostic ===');
  console.log('Client:', client.full_name, '| id:', client.id);
  console.log('Cutoff:', cutoffDate.toISOString(), '| Source:', updatedAfter ? 'snapshot at cutoff' : 'upcoming_order');
  console.log('');

  // 1) Raw structure: for each meal key, what are the item IDs (keys of .items)?
  const allSnapshotItemIds = new Set<string>();
  console.log('--- 1) Raw mealSelections and item IDs from snapshot ---');
  for (const [mealKey, group] of Object.entries(mealSel)) {
    const g = group as { vendorId?: string; vendor_id?: string; items?: Record<string, number> };
    const items = g?.items ?? {};
    const itemIds = Object.keys(items).filter((id) => Number(items[id]) > 0);
    console.log(`Meal key: "${mealKey}"`);
    console.log('  vendorId:', g?.vendorId ?? g?.vendor_id ?? '(none)');
    console.log('  items (id -> qty):', Object.keys(items).length ? JSON.stringify(items) : '(empty)');
    console.log('  item IDs (keys):', itemIds.length ? itemIds : '(none)');
    itemIds.forEach((id) => allSnapshotItemIds.add(id));
    console.log('');
  }

  if (allSnapshotItemIds.size === 0) {
    console.log('No item IDs found in any meal selection. Structure might use a different property (e.g. itemIds array).');
    console.log('Full mealSelections sample (first key):');
    const firstKey = Object.keys(mealSel)[0];
    if (firstKey) console.log(JSON.stringify((mealSel as any)[firstKey], null, 2));
    process.exit(0);
  }

  // 2) Load DB item IDs
  const { data: breakfastRows } = await supabase.from('breakfast_items').select('id, name, category_id');
  const { data: menuRows } = await supabase.from('menu_items').select('id, name, vendor_id, category_id');
  const breakfastItems = (breakfastRows || []) as { id: string; name: string; category_id: string | null }[];
  const menuItems = (menuRows || []) as { id: string; name: string; vendor_id: string | null; category_id: string | null }[];

  const breakfastIds = new Set<string>();
  const breakfastIdsLower = new Map<string, string>();
  breakfastItems.forEach((r) => {
    breakfastIds.add(r.id);
    if (typeof r.id === 'string') breakfastIdsLower.set(r.id.toLowerCase(), r.id);
  });
  const menuIds = new Set<string>();
  const menuIdsLower = new Map<string, string>();
  menuItems.forEach((r) => {
    menuIds.add(r.id);
    if (typeof r.id === 'string') menuIdsLower.set(r.id.toLowerCase(), r.id);
  });

  console.log('--- 2) DB item counts ---');
  console.log('breakfast_items count:', breakfastItems.length);
  console.log('menu_items count:', menuItems.length);
  console.log('Sample breakfast_items ids (first 5):', breakfastItems.slice(0, 5).map((r) => ({ id: r.id, type: typeof r.id, name: r.name })));
  console.log('Sample menu_items ids (first 5):', menuItems.slice(0, 5).map((r) => ({ id: r.id, type: typeof r.id, name: r.name })));
  console.log('');

  // 3) For each snapshot item ID, check presence and type
  console.log('--- 3) Lookup result per snapshot item ID ---');
  const notInBreakfast: string[] = [];
  const notInMenu: string[] = [];
  const inBreakfast: string[] = [];
  const inMenu: string[] = [];

  for (const id of allSnapshotItemIds) {
    const inB = breakfastIds.has(id);
    const inM = menuIds.has(id);
    const inBLower = typeof id === 'string' && breakfastIdsLower.has(id.toLowerCase());
    const inMLower = typeof id === 'string' && menuIdsLower.has(id.toLowerCase());
    if (inB) inBreakfast.push(id);
    else if (inBLower) inBreakfast.push(id + ' (match via lower case)');
    else notInBreakfast.push(id);
    if (inM) inMenu.push(id);
    else if (inMLower) inMenu.push(id + ' (match via lower case)');
    else notInMenu.push(id);

    console.log(`  "${id}"`);
    console.log('    type:', typeof id, '| length:', String(id).length);
    console.log('    in breakfast_items (strict):', inB, '| in menu_items (strict):', inM);
    if (!inB && !inM) {
      console.log('    in breakfast_items (lower):', inBLower, '| in menu_items (lower):', inMLower);
      // Check if it looks like a UUID
      const uuidLike = /^[0-9a-fA-F-]{32,36}$/.test(String(id).replace(/-/g, ''));
      console.log('    looks like UUID:', uuidLike);
    }
  }

  console.log('');
  console.log('--- 4) Summary ---');
  console.log('Snapshot item IDs found in breakfast_items:', inBreakfast.length);
  console.log('Snapshot item IDs found in menu_items:', inMenu.length);
  console.log('Snapshot item IDs in NEITHER:', notInBreakfast.filter((id) => !menuIds.has(id)).length);
  if (notInBreakfast.length > 0 && notInMenu.length > 0) {
    const neither = [...allSnapshotItemIds].filter((id) => !breakfastIds.has(id) && !menuIds.has(id));
    if (neither.length > 0) {
      console.log('IDs in neither table:', neither);
      console.log('');
      console.log('Possible causes:');
      console.log('- Item IDs in snapshot are from a different table (e.g. meal package or category id).');
      console.log('- Items were deleted from breakfast_items/menu_items after the snapshot.');
      console.log('- ID format mismatch (e.g. number in snapshot vs string UUID in DB, or different casing).');
    }
  }

  // 5) Check if snapshot "item" IDs are actually category IDs
  const { data: breakfastCatRows } = await supabase.from('breakfast_categories').select('id, name, meal_type');
  const { data: itemCatRows } = await supabase.from('item_categories').select('id, name');
  const breakfastCategoryIds = new Set((breakfastCatRows || []).map((r: any) => r.id));
  const itemCategoryIds = new Set((itemCatRows || []).map((r: any) => r.id));
  const neitherIds = [...allSnapshotItemIds].filter((id) => !breakfastIds.has(id) && !menuIds.has(id));
  const inBreakfastCat = neitherIds.filter((id) => breakfastCategoryIds.has(id));
  const inItemCat = neitherIds.filter((id) => itemCategoryIds.has(id));

  console.log('');
  console.log('--- 5) Are missing IDs actually category IDs? ---');
  console.log('Snapshot IDs that are in breakfast_categories:', inBreakfastCat.length, inBreakfastCat.slice(0, 5));
  console.log('Snapshot IDs that are in item_categories:', inItemCat.length, inItemCat.slice(0, 5));
  if (inBreakfastCat.length > 0 || inItemCat.length > 0) {
    console.log('-> SOURCE OF ISSUE: .items keys appear to be category IDs, not item IDs. Backfill expects keys to be breakfast_items.id / menu_items.id.');
  }

  const mealKeys = Object.keys(mealSel);
  if (mealKeys.some((k) => /_\d+$/.test(k))) {
    console.log('');
    console.log('Meal keys look like "Name_timestamp". breakfast_categories sample:', (breakfastCatRows || []).slice(0, 3));
  }

  console.log('');
  console.log('=== Done ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
