/**
 * Remove inactive items from orders and fix order total_value and total_items.
 * Filter: orders by Scheduled Delivery (scheduled_delivery_date) in range Feb 15–21.
 * Same "inactive" definition as count script: item or its category is inactive.
 *
 * Run:
 *   # Orders with Scheduled Delivery Feb 15–21 (default: current year)
 *   npx tsx scripts/remove-inactive-items-from-week-orders.ts --dry-run
 *   npx tsx scripts/remove-inactive-items-from-week-orders.ts
 *
 *   # Specific year (e.g. order scheduled for 2025-02-17)
 *   npx tsx scripts/remove-inactive-items-from-week-orders.ts --year=2025
 *
 *   # Single order by ID (any Scheduled Delivery date)
 *   npx tsx scripts/remove-inactive-items-from-week-orders.ts <order-id>
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY in .env.local (for writes).
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const argv = args.filter((a) => !a.startsWith('--'));
const DRY_RUN = args.includes('--dry-run');
const ORDER_ID_ARG = argv.find((a) => a.length === 36 && a.includes('-')); // UUID-like
const yearArg = args.find((a) => a.startsWith('--year='));
const YEAR = yearArg ? parseInt(yearArg.split('=')[1], 10) : new Date().getFullYear();
if (isNaN(YEAR)) {
  console.error('Invalid --year= value');
  process.exit(1);
}

// Scheduled Delivery (scheduled_delivery_date) range: Feb 15–21
const START = `${YEAR}-02-15`;
const END = `${YEAR}-02-21`;

const BATCH = 200;

type OrderRow = { id: string; order_number: number; service_type: string; scheduled_delivery_date: string };
type OrderItemRow = { id: string; order_id: string; menu_item_id: string | null; meal_item_id: string | null; quantity: number; unit_value?: number; custom_price?: number | string };
type BoxSelectionRow = {
  id: string;
  order_id: string;
  quantity: number;
  unit_value?: number;
  total_value?: number;
  items: Record<string, unknown> | null;
};
type MenuItemRow = { id: string; name: string; is_active: boolean; category_id: string | null; price_each?: number | null; value?: number | null };
type BreakfastItemRow = { id: string; name: string; is_active: boolean; category_id: string | null; price_each?: number | null };
type CategoryRow = { id: string; is_active?: boolean };

function batches(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) out.push(ids.slice(i, i + BATCH));
  return out;
}

function parseBoxItems(items: Record<string, unknown> | null): { itemId: string; quantity: number; price?: number }[] {
  if (!items || typeof items !== 'object') return [];
  const out: { itemId: string; quantity: number; price?: number }[] = [];
  for (const [itemId, val] of Object.entries(items)) {
    if (typeof val === 'number' && val > 0) out.push({ itemId, quantity: val });
    else if (val && typeof val === 'object' && 'quantity' in val) {
      const q = (val as { quantity: number }).quantity;
      const p = (val as { price?: number }).price;
      if (typeof q === 'number' && q > 0) out.push({ itemId, quantity: q, price: typeof p === 'number' ? p : undefined });
    }
  }
  return out;
}

async function main() {
  let orderList: OrderRow[];

  if (ORDER_ID_ARG) {
    console.log(`Remove inactive items from order ${ORDER_ID_ARG}. ${DRY_RUN ? '(DRY RUN - no changes)' : 'APPLYING CHANGES'}\n`);
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_number, service_type, scheduled_delivery_date')
      .eq('id', ORDER_ID_ARG)
      .maybeSingle();
    if (orderErr || !order) {
      console.error('Order not found:', ORDER_ID_ARG, orderErr?.message || '');
      process.exit(1);
    }
    orderList = [order as OrderRow];
  } else {
    console.log(`Remove inactive items from orders with Scheduled Delivery ${START} to ${END}. ${DRY_RUN ? '(DRY RUN - no changes)' : 'APPLYING CHANGES'}\n`);
    // Supabase returns max 1000 rows per query; paginate to get all orders in range (e.g. 2026-02-17 orders were being skipped)
    orderList = [];
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const { data: page, error: ordersErr } = await supabase
        .from('orders')
        .select('id, order_number, service_type, scheduled_delivery_date')
        .gte('scheduled_delivery_date', START)
        .lte('scheduled_delivery_date', END)
        .order('scheduled_delivery_date', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (ordersErr) {
        console.error('Error fetching orders:', ordersErr);
        process.exit(1);
      }
      const rows = (page || []) as OrderRow[];
      orderList.push(...rows);
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
    console.log(`Orders with Scheduled Delivery in range: ${orderList.length}\n`);
  }

  if (orderList.length === 0) {
    console.log('No orders to process.');
    return;
  }
  const orderIds = orderList.map((o) => o.id);
  const orderMap = new Map<string, OrderRow>();
  for (const o of orderList) orderMap.set(o.id, o);

  // Categories
  const { data: itemCategories } = await supabase.from('item_categories').select('id, is_active');
  const { data: breakfastCategories } = await supabase.from('breakfast_categories').select('id, is_active');
  const activeItemCategoryIds = new Set<string>(
    (itemCategories || []).filter((r: CategoryRow) => r.is_active === true).map((r: CategoryRow) => r.id)
  );
  const activeBreakfastCategoryIds = new Set<string>(
    (breakfastCategories || []).filter((r: CategoryRow) => r.is_active === true).map((r: CategoryRow) => r.id)
  );

  // Menu and breakfast items with prices (for box value recalc)
  const { data: menuItems, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name, is_active, category_id, price_each, value');
  const { data: breakfastItems, error: breakfastErr } = await supabase
    .from('breakfast_items')
    .select('id, name, is_active, category_id, price_each');

  if (menuErr || breakfastErr) {
    console.error('Error fetching items:', menuErr || breakfastErr);
    process.exit(1);
  }

  const menuInactive = new Map<string, boolean>();
  const menuPrice = new Map<string, number>();
  for (const r of menuItems || []) {
    const row = r as MenuItemRow;
    const itemActive = row.is_active === true;
    const categoryActive =
      row.category_id == null || row.category_id === '' || activeItemCategoryIds.size === 0 || activeItemCategoryIds.has(row.category_id);
    menuInactive.set(row.id, !itemActive || !categoryActive);
    const price = row.price_each != null ? Number(row.price_each) : (row.value != null ? Number(row.value) : 0);
    menuPrice.set(row.id, price);
  }
  const breakfastInactive = new Map<string, boolean>();
  const breakfastPrice = new Map<string, number>();
  for (const r of breakfastItems || []) {
    const row = r as BreakfastItemRow;
    const itemActive = row.is_active === true;
    const categoryActive =
      row.category_id == null || row.category_id === '' || activeBreakfastCategoryIds.size === 0 || activeBreakfastCategoryIds.has(row.category_id);
    breakfastInactive.set(row.id, !itemActive || !categoryActive);
    breakfastPrice.set(row.id, row.price_each != null ? Number(row.price_each) : 0);
  }

  function isInactive(itemId: string): boolean {
    if (menuInactive.has(itemId)) return menuInactive.get(itemId)!;
    if (breakfastInactive.has(itemId)) return breakfastInactive.get(itemId)!;
    return false;
  }

  function getItemPrice(itemId: string): number {
    if (menuPrice.has(itemId)) return menuPrice.get(itemId)!;
    if (breakfastPrice.has(itemId)) return breakfastPrice.get(itemId)!;
    return 0;
  }

  // Fetch order_items (with unit_value, custom_price for recalc)
  const itemRows: OrderItemRow[] = [];
  for (const batch of batches(orderIds)) {
    const { data, error } = await supabase
      .from('order_items')
      .select('id, order_id, menu_item_id, meal_item_id, quantity, unit_value, custom_price')
      .in('order_id', batch);
    if (error) {
      console.error('Error fetching order_items:', error);
      process.exit(1);
    }
    itemRows.push(...((data || []) as OrderItemRow[]));
  }

  // Fetch order_box_selections
  const boxRows: BoxSelectionRow[] = [];
  for (const batch of batches(orderIds)) {
    const { data, error } = await supabase
      .from('order_box_selections')
      .select('id, order_id, quantity, unit_value, total_value, items')
      .in('order_id', batch);
    if (error) {
      console.error('Error fetching order_box_selections:', error);
      process.exit(1);
    }
    boxRows.push(...((data || []) as BoxSelectionRow[]));
  }

  const affectedOrderIds = new Set<string>();
  const boxSelectionNewTotal = new Map<string, number>(); // id -> new total_value after removing inactive
  let deletedOrderItemCount = 0;
  let updatedBoxSelectionCount = 0;

  // 1) Delete inactive order_items
  const toDeleteItemIds: string[] = [];
  for (const row of itemRows) {
    const itemId = row.menu_item_id || row.meal_item_id;
    if (itemId && isInactive(itemId)) {
      toDeleteItemIds.push(row.id);
      affectedOrderIds.add(row.order_id);
    }
  }
  if (toDeleteItemIds.length > 0) {
    if (!DRY_RUN) {
      for (let i = 0; i < toDeleteItemIds.length; i += BATCH) {
        const chunk = toDeleteItemIds.slice(i, i + BATCH);
        const { error } = await supabase.from('order_items').delete().in('id', chunk);
        if (error) {
          console.error('Error deleting order_items:', error);
          process.exit(1);
        }
      }
    }
    deletedOrderItemCount = toDeleteItemIds.length;
    console.log(`Order items to delete (inactive): ${toDeleteItemIds.length}${DRY_RUN ? ' (dry-run)' : ' — deleted.'}`);
  }

  // 2) Update order_box_selections: remove inactive keys from items, recalc total_value
  for (const row of boxRows) {
    const entries = parseBoxItems(row.items);
    const toRemove = new Set(entries.filter((e) => isInactive(e.itemId)).map((e) => e.itemId));
    if (toRemove.size === 0) continue;

    const newItems: Record<string, number | { quantity: number; price?: number }> = {};
    let newTotalValue = 0;
    for (const { itemId, quantity, price } of entries) {
      if (toRemove.has(itemId)) continue;
      const p = price !== undefined ? price : getItemPrice(itemId);
      newTotalValue += p * quantity;
      if (price !== undefined) newItems[itemId] = { quantity, price };
      else newItems[itemId] = quantity;
    }

    affectedOrderIds.add(row.order_id);
    const qty = Number(row.quantity) || 1;
    const newUnitValue = qty > 0 ? newTotalValue / qty : 0;

    boxSelectionNewTotal.set(row.id, newTotalValue);
    if (!DRY_RUN) {
      const { error } = await supabase
        .from('order_box_selections')
        .update({ items: newItems, total_value: newTotalValue, unit_value: newUnitValue })
        .eq('id', row.id);
      if (error) {
        console.error('Error updating order_box_selection', row.id, error);
        process.exit(1);
      }
    }
    updatedBoxSelectionCount++;
  }
  if (updatedBoxSelectionCount > 0) {
    console.log(`Box selections to update (inactive items removed): ${updatedBoxSelectionCount}${DRY_RUN ? ' (dry-run)' : ' — updated.'}`);
  }

  // 3) Recalc order total_value and total_items for affected orders
  const affectedList = Array.from(affectedOrderIds);
  console.log(`\nOrders with inactive items to fix: ${affectedList.length} (of ${orderList.length} in range)`);
  console.log(`Recalculating total_value and total_items for ${affectedList.length} affected orders...`);

  for (const orderId of affectedList) {
    const order = orderMap.get(orderId);
    if (!order) continue;

    if (order.service_type === 'Food' || order.service_type === 'Meal') {
      const { data: items, error } = await supabase
        .from('order_items')
        .select('unit_value, quantity, custom_price')
        .eq('order_id', orderId);
      if (error) {
        console.error('Error fetching order_items for recalc:', orderId, error);
        continue;
      }
      const rows = (items || []) as { unit_value?: number; quantity: number; custom_price?: number | string }[];
      let totalValue = 0;
      let totalItems = 0;
      for (const item of rows) {
        const q = Number(item.quantity) || 0;
        const price = item.custom_price != null ? Number(item.custom_price) : Number(item.unit_value) || 0;
        totalValue += price * q;
        totalItems += q;
      }
      if (!DRY_RUN) {
        const { error: upErr } = await supabase.from('orders').update({ total_value: totalValue, total_items: totalItems }).eq('id', orderId);
        if (upErr) console.error('Error updating order', order.order_number, upErr);
      }
      if (affectedList.indexOf(orderId) < 5) {
        console.log(`  Order #${order.order_number} (${order.service_type}): total_value=${totalValue.toFixed(2)}, total_items=${totalItems}`);
      }
    } else if (order.service_type === 'Boxes') {
      const { data: selections, error } = await supabase
        .from('order_box_selections')
        .select('id, total_value, quantity')
        .eq('order_id', orderId);
      if (error) {
        console.error('Error fetching box selections for recalc:', orderId, error);
        continue;
      }
      const rows = (selections || []) as { id: string; total_value?: number; quantity: number }[];
      const totalValue = rows.reduce((s, r) => s + (boxSelectionNewTotal.get(r.id) ?? Number(r.total_value) ?? 0), 0);
      const totalItems = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
      if (!DRY_RUN) {
        const { error: upErr } = await supabase.from('orders').update({ total_value: totalValue, total_items: totalItems }).eq('id', orderId);
        if (upErr) console.error('Error updating order', order.order_number, upErr);
      }
      if (affectedList.indexOf(orderId) < 5) {
        console.log(`  Order #${order.order_number} (Boxes): total_value=${totalValue.toFixed(2)}, total_items=${totalItems}`);
      }
    }
  }

  console.log('\nDone.');
  if (DRY_RUN) {
    console.log('Run without --dry-run to apply changes.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
