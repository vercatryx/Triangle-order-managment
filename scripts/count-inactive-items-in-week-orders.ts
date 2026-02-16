/**
 * Count inactive items in orders scheduled for delivery Feb 15–21 (this week).
 * Treats an item as inactive if:
 * - the item itself is inactive (menu_items.is_active / breakfast_items.is_active = false), OR
 * - the item is in a category that is inactive (item_categories.is_active / breakfast_categories.is_active = false).
 * Reads from: orders, order_items, order_box_selections, menu_items, breakfast_items, item_categories, breakfast_categories.
 *
 * Run: npx tsx scripts/count-inactive-items-in-week-orders.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Feb 15–21 "this week" in the current year
const now = new Date();
const year = now.getFullYear();
const START = `${year}-02-15`;
const END = `${year}-02-21`;

const MAX_EXAMPLES = 25;

type OrderRow = { id: string; order_number: number; service_type: string; scheduled_delivery_date: string };
type OrderItemRow = { id: string; order_id: string; menu_item_id: string | null; meal_item_id: string | null; quantity: number };
type BoxSelectionRow = { id: string; order_id: string; items: Record<string, number> | Record<string, { quantity: number }> };
type MenuItemRow = { id: string; name: string; is_active: boolean; category_id: string | null };
type BreakfastItemRow = { id: string; name: string; is_active: boolean; category_id: string | null };
type CategoryRow = { id: string; name?: string; is_active?: boolean };

type InactiveReason = 'item_inactive' | 'category_inactive';
type ItemInfo = { name: string; reason: InactiveReason };
type Example = {
  orderNumber: number;
  deliveryDate: string;
  serviceType: string;
  source: 'order_item' | 'box';
  itemName: string;
  itemId: string;
  quantity: number;
  reason: InactiveReason;
};

function parseBoxItems(items: Record<string, unknown> | null): { itemId: string; quantity: number }[] {
  if (!items || typeof items !== 'object') return [];
  const out: { itemId: string; quantity: number }[] = [];
  for (const [itemId, val] of Object.entries(items)) {
    if (typeof val === 'number' && val > 0) out.push({ itemId, quantity: val });
    else if (val && typeof val === 'object' && 'quantity' in val && typeof (val as { quantity: number }).quantity === 'number')
      out.push({ itemId, quantity: (val as { quantity: number }).quantity });
  }
  return out;
}

async function main() {
  console.log(`Counting inactive items in orders with scheduled_delivery_date ${START} to ${END}.\n`);

  // 1) Orders in range
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, order_number, service_type, scheduled_delivery_date')
    .gte('scheduled_delivery_date', START)
    .lte('scheduled_delivery_date', END)
    .order('scheduled_delivery_date', { ascending: true });

  if (ordersErr) {
    console.error('Error fetching orders:', ordersErr);
    process.exit(1);
  }
  const orderList = (orders || []) as OrderRow[];
  console.log(`Orders in range: ${orderList.length}`);

  if (orderList.length === 0) {
    console.log('\nNo orders in this range. Inactive item count: 0');
    return;
  }

  const orderIds = orderList.map((o) => o.id);

  const BATCH = 200;
  const batches = (ids: string[]) => {
    const out: string[][] = [];
    for (let i = 0; i < ids.length; i += BATCH) out.push(ids.slice(i, i + BATCH));
    return out;
  };

  const orderMap = new Map<string, { order_number: number; scheduled_delivery_date: string; service_type: string }>();
  for (const o of orderList) orderMap.set(o.id, { order_number: o.order_number, scheduled_delivery_date: o.scheduled_delivery_date, service_type: o.service_type });

  // 2) Categories: only explicit true is active (if is_active column missing, we get undefined → treat as active so we don't over-count)
  const { data: itemCategories, error: itemCatErr } = await supabase
    .from('item_categories')
    .select('id, name, is_active');
  const { data: breakfastCategories, error: breakfastCatErr } = await supabase
    .from('breakfast_categories')
    .select('id, name, is_active');

  if (itemCatErr) console.warn('item_categories (is_active):', itemCatErr.message);
  if (breakfastCatErr) console.warn('breakfast_categories (is_active):', breakfastCatErr.message);

  const activeItemCategoryIds = new Set<string>(
    (itemCategories || []).filter((r: CategoryRow) => r.is_active === true).map((r: CategoryRow) => r.id)
  );
  const activeBreakfastCategoryIds = new Set<string>(
    (breakfastCategories || []).filter((r: CategoryRow) => r.is_active === true).map((r: CategoryRow) => r.id)
  );
  // 3) All menu_items and breakfast_items (id, name, is_active, category_id)
  const { data: menuItems, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name, is_active, category_id');
  const { data: breakfastItems, error: breakfastErr } = await supabase
    .from('breakfast_items')
    .select('id, name, is_active, category_id');

  if (menuErr || breakfastErr) {
    console.error('Error fetching items:', menuErr || breakfastErr);
    process.exit(1);
  }

  // Item is inactive if: item.is_active is false OR (item has category and that category is not in active set)
  const menuInactive = new Map<string, boolean>();
  const menuItemInfo = new Map<string, ItemInfo>();
  for (const r of menuItems || []) {
    const row = r as MenuItemRow;
    const itemActive = row.is_active === true;
    const categoryActive =
      row.category_id == null ||
      row.category_id === '' ||
      activeItemCategoryIds.size === 0 ||
      activeItemCategoryIds.has(row.category_id);
    const inactive = !itemActive || !categoryActive;
    menuInactive.set(row.id, inactive);
    if (inactive) {
      const reason: InactiveReason = !itemActive ? 'item_inactive' : 'category_inactive';
      menuItemInfo.set(row.id, { name: row.name || row.id, reason });
    }
  }
  const breakfastInactive = new Map<string, boolean>();
  const breakfastItemInfo = new Map<string, ItemInfo>();
  for (const r of breakfastItems || []) {
    const row = r as BreakfastItemRow;
    const itemActive = row.is_active === true;
    const categoryActive =
      row.category_id == null ||
      row.category_id === '' ||
      activeBreakfastCategoryIds.size === 0 ||
      activeBreakfastCategoryIds.has(row.category_id);
    const inactive = !itemActive || !categoryActive;
    breakfastInactive.set(row.id, inactive);
    if (inactive) {
      const reason: InactiveReason = !itemActive ? 'item_inactive' : 'category_inactive';
      breakfastItemInfo.set(row.id, { name: row.name || row.id, reason });
    }
  }

  function isInactiveItem(itemId: string): boolean {
    if (menuInactive.has(itemId)) return menuInactive.get(itemId)!;
    if (breakfastInactive.has(itemId)) return breakfastInactive.get(itemId)!;
    return false; // unknown id: don't count as inactive
  }

  function getItemInfo(itemId: string): ItemInfo | null {
    if (menuItemInfo.has(itemId)) return menuItemInfo.get(itemId)!;
    if (breakfastItemInfo.has(itemId)) return breakfastItemInfo.get(itemId)!;
    return null;
  }

  // 4) order_items for these orders (batched)
  const itemRows: OrderItemRow[] = [];
  for (const batch of batches(orderIds)) {
    const { data, error } = await supabase
      .from('order_items')
      .select('id, order_id, menu_item_id, meal_item_id, quantity')
      .in('order_id', batch);
    if (error) {
      console.error('Error fetching order_items:', error);
      process.exit(1);
    }
    itemRows.push(...((data || []) as OrderItemRow[]));
  }

  // 5) order_box_selections for these orders (batched)
  const boxRows: BoxSelectionRow[] = [];
  for (const batch of batches(orderIds)) {
    const { data, error } = await supabase
      .from('order_box_selections')
      .select('id, order_id, items')
      .in('order_id', batch);
    if (error) {
      console.error('Error fetching order_box_selections:', error);
      process.exit(1);
    }
    boxRows.push(...((data || []) as BoxSelectionRow[]));
  }

  // 6) Count inactive from order_items and collect examples
  let inactiveOrderItemsCount = 0;
  let inactiveOrderItemsUnits = 0;
  const examples: Example[] = [];

  for (const row of itemRows) {
    const itemId = row.menu_item_id || row.meal_item_id;
    const inactive = itemId && isInactiveItem(itemId);
    if (inactive && itemId) {
      inactiveOrderItemsCount += 1;
      inactiveOrderItemsUnits += row.quantity || 1;
      if (examples.length < MAX_EXAMPLES) {
        const ord = orderMap.get(row.order_id);
        const info = getItemInfo(itemId);
        if (ord && info) {
          examples.push({
            orderNumber: ord.order_number,
            deliveryDate: ord.scheduled_delivery_date,
            serviceType: ord.service_type,
            source: 'order_item',
            itemName: info.name,
            itemId,
            quantity: row.quantity || 1,
            reason: info.reason,
          });
        }
      }
    }
  }

  // 7) Count inactive from order_box_selections and add box examples
  let inactiveBoxItemEntries = 0;
  let inactiveBoxItemUnits = 0;

  for (const row of boxRows) {
    const ord = orderMap.get(row.order_id);
    const entries = parseBoxItems(row.items as Record<string, unknown>);
    for (const { itemId, quantity } of entries) {
      if (isInactiveItem(itemId)) {
        inactiveBoxItemEntries += 1;
        inactiveBoxItemUnits += quantity;
        if (examples.length < MAX_EXAMPLES && ord) {
          const info = getItemInfo(itemId);
          if (info) {
            examples.push({
              orderNumber: ord.order_number,
              deliveryDate: ord.scheduled_delivery_date,
              serviceType: ord.service_type,
              source: 'box',
              itemName: info.name,
              itemId,
              quantity,
              reason: info.reason,
            });
          }
        }
      }
    }
  }

  // Output
  console.log('\n--- Inactive item count (this week) ---');
  console.log('From order_items (Food/Meal lines):');
  console.log(`  Rows with inactive item: ${inactiveOrderItemsCount}`);
  console.log(`  Total units (quantity):  ${inactiveOrderItemsUnits}`);
  console.log('From order_box_selections (Box items):');
  console.log(`  Inactive item entries:  ${inactiveBoxItemEntries}`);
  console.log(`  Total units:             ${inactiveBoxItemUnits}`);
  console.log('\nTotal inactive item count (units):', inactiveOrderItemsUnits + inactiveBoxItemUnits);

  if (examples.length > 0) {
    console.log(`\n--- Examples (first ${examples.length}) ---`);
    for (const ex of examples) {
      const reasonLabel = ex.reason === 'item_inactive' ? 'item inactive' : 'category inactive';
      console.log(`  Order #${ex.orderNumber} (${ex.deliveryDate}, ${ex.serviceType}) | ${ex.source}: "${ex.itemName}" x${ex.quantity} — ${reasonLabel}`);
    }
  }
}

main();
