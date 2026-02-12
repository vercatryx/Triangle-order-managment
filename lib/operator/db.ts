/**
 * Operator's own DB client. Uses mysql2 directly.
 * Does NOT import from lib/db or lib/supabase.
 * Uses same env vars: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.
 */

import mysql from 'mysql2/promise';
import type { OperatorCurrentOrder, OperatorMenuItem, OperatorLastOrder, OperatorItemDetail } from './types';

const config = {
  host: process.env.MYSQL_HOST || process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || process.env.DATABASE_PORT || '3306', 10),
  user: process.env.MYSQL_USER || process.env.DATABASE_USER || 'root',
  password: process.env.MYSQL_PASSWORD || process.env.DATABASE_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || process.env.DATABASE_NAME || 'triangle_orders',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
};

let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool(config);
  }
  return pool;
}

export interface OperatorDbRow {
  id?: string;
  full_name?: string;
  phone_number?: string | null;
  secondary_phone_number?: string | null;
  service_type?: string;
  status_id?: string | null;
  expiration_date?: Date | string | null;
  parent_client_id?: string | null;
  upcoming_order?: unknown;
  order_history?: unknown;
}

/** Execute a parameterized query. */
export async function operatorQuery<T = unknown>(
  sql: string,
  params: unknown[] = []
): Promise<{ rows: T[]; error: Error | null }> {
  const p = getPool();
  try {
    const [rows] = await p.execute(sql, params);
    const arr = Array.isArray(rows) ? (rows as T[]) : [];
    return { rows: arr, error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/** Get client by primary or secondary phone. Accepts variants for flexible matching. */
export async function operatorGetClientByPhone(
  phoneVariants: string[]
): Promise<{ client: OperatorDbRow | null; error: Error | null }> {
  if (phoneVariants.length === 0) return { client: null, error: null };
  const placeholders = phoneVariants.map(() => '(phone_number = ? OR secondary_phone_number = ?)').join(' OR ');
  const params = phoneVariants.flatMap((v) => [v, v]);
  const { rows, error } = await operatorQuery<OperatorDbRow>(
    `SELECT id, full_name, phone_number, secondary_phone_number, service_type, status_id, expiration_date, parent_client_id
     FROM clients
     WHERE (${placeholders})
       AND (parent_client_id IS NULL OR parent_client_id = '')
     LIMIT 2`,
    params
  );
  if (error) return { client: null, error };
  if (rows.length === 0) return { client: null, error: null };
  if (rows.length > 1) return { client: null, error: new Error('Multiple clients match this phone number') };
  return { client: rows[0], error: null };
}

/** Get client by full name (case-insensitive exact match). */
export async function operatorGetClientByName(
  fullName: string
): Promise<{ client: OperatorDbRow | null; error: Error | null }> {
  const trimmed = typeof fullName === 'string' ? fullName.trim() : '';
  if (!trimmed) return { client: null, error: null };

  const { rows, error } = await operatorQuery<OperatorDbRow>(
    `SELECT id, full_name, phone_number, secondary_phone_number, service_type, status_id, expiration_date, parent_client_id
     FROM clients
     WHERE LOWER(TRIM(full_name)) = LOWER(?)
       AND (parent_client_id IS NULL OR parent_client_id = '')
     LIMIT 2`,
    [trimmed]
  );
  if (error) return { client: null, error };
  if (rows.length === 0) return { client: null, error: null };
  if (rows.length > 1) return { client: null, error: new Error('Multiple clients match this name') };
  return { client: rows[0], error: null };
}

/** Get client by first name when full name is unknown. Matches clients whose full_name starts with the given name. */
export async function operatorGetClientByFirstName(
  firstName: string
): Promise<{ client: OperatorDbRow | null; error: Error | null }> {
  const trimmed = typeof firstName === 'string' ? firstName.trim() : '';
  if (!trimmed || trimmed.includes(' ')) return { client: null, error: null };

  const { rows, error } = await operatorQuery<OperatorDbRow>(
    `SELECT id, full_name, phone_number, secondary_phone_number, service_type, status_id, expiration_date, parent_client_id
     FROM clients
     WHERE (LOWER(TRIM(full_name)) = LOWER(?) OR LOWER(TRIM(full_name)) LIKE CONCAT(LOWER(?), ' %'))
       AND (parent_client_id IS NULL OR parent_client_id = '')
     LIMIT 3`,
    [trimmed, trimmed]
  );
  if (error) return { client: null, error };
  if (rows.length === 0) return { client: null, error: null };
  if (rows.length > 1) return { client: null, error: new Error('Multiple clients match this first name; please provide full name') };
  return { client: rows[0], error: null };
}

/** Get client by ID. */
export async function operatorGetClientById(
  clientId: string
): Promise<{ client: OperatorDbRow | null; error: Error | null }> {
  const { rows, error } = await operatorQuery<OperatorDbRow>(
    `SELECT id, full_name, phone_number, secondary_phone_number, service_type, status_id, expiration_date, parent_client_id
     FROM clients
     WHERE id = ? AND (parent_client_id IS NULL OR parent_client_id = '')
     LIMIT 1`,
    [clientId]
  );
  if (error) return { client: null, error };
  return { client: rows[0] ?? null, error: null };
}

/** Get client status by ID (for eligibility). */
export async function operatorGetClientStatus(
  statusId: string
): Promise<{ deliveriesAllowed: boolean; error: Error | null }> {
  const { rows, error } = await operatorQuery<{ deliveries_allowed: number | boolean }>(
    `SELECT deliveries_allowed FROM client_statuses WHERE id = ? LIMIT 1`,
    [statusId]
  );
  if (error) return { deliveriesAllowed: false, error };
  const row = rows[0];
  const allowed = row?.deliveries_allowed === true || row?.deliveries_allowed === 1;
  return { deliveriesAllowed: allowed, error: null };
}

/** Check if vendor exists. */
export async function operatorVendorExists(vendorId: string): Promise<boolean> {
  const { rows, error } = await operatorQuery<{ id: string }>(
    `SELECT id FROM vendors WHERE id = ? AND is_active = 1 LIMIT 1`,
    [vendorId]
  );
  return !error && rows.length > 0;
}

/** Update client's upcoming_order. Operator's own implementation. */
export async function operatorUpdateClientUpcomingOrder(
  clientId: string,
  payload: object
): Promise<{ error: Error | null }> {
  const json = JSON.stringify(payload);
  const { error } = await operatorQuery(
    `UPDATE clients SET upcoming_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [json, clientId]
  );
  return { error };
}

/** Get item details for Food/Meal orders (order_items + menu_items/breakfast_items). */
async function operatorGetOrderItemsForOrders(
  orderIds: string[]
): Promise<Record<string, OperatorItemDetail[]>> {
  if (orderIds.length === 0) return {};
  const placeholders = orderIds.map(() => '?').join(',');
  const { rows, error } = await operatorQuery<{
    order_id: string;
    name: string | null;
    unit_value: number;
    total_value: number;
    quantity: number;
  }>(
    `SELECT oi.order_id,
            COALESCE(oi.custom_name, mi.name, bi.name, 'Unknown') AS name,
            COALESCE(oi.custom_price, oi.unit_value, mi.price_each, bi.price_each, 0) AS unit_value,
            oi.total_value, oi.quantity
     FROM order_items oi
     LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
     LEFT JOIN breakfast_items bi ON oi.meal_item_id = bi.id
     WHERE oi.order_id IN (${placeholders})`,
    orderIds
  );
  if (error) return {};
  const byOrder: Record<string, OperatorItemDetail[]> = {};
  for (const r of rows) {
    const items = byOrder[r.order_id] ?? [];
    items.push({
      name: r.name ?? 'Unknown',
      price: Number(r.unit_value) ?? 0,
      value: Number(r.total_value) ?? 0,
      quantity: r.quantity ?? 1,
    });
    byOrder[r.order_id] = items;
  }
  return byOrder;
}

/** Get item details for Box orders (order_box_selections + box_types). */
async function operatorGetBoxSelectionsForOrders(
  orderIds: string[]
): Promise<Record<string, OperatorItemDetail[]>> {
  if (orderIds.length === 0) return {};
  const placeholders = orderIds.map(() => '?').join(',');
  const { rows, error } = await operatorQuery<{
    order_id: string;
    name: string | null;
    unit_value: number;
    total_value: number;
    quantity: number;
  }>(
    `SELECT obs.order_id,
            COALESCE(bt.name, 'Box') AS name,
            obs.unit_value, obs.total_value, obs.quantity
     FROM order_box_selections obs
     LEFT JOIN box_types bt ON obs.box_type_id = bt.id
     WHERE obs.order_id IN (${placeholders})`,
    orderIds
  );
  if (error) return {};
  const byOrder: Record<string, OperatorItemDetail[]> = {};
  for (const r of rows) {
    const items = byOrder[r.order_id] ?? [];
    items.push({
      name: r.name ?? 'Box',
      price: Number(r.unit_value) ?? 0,
      value: Number(r.total_value) ?? 0,
      quantity: r.quantity ?? 1,
    });
    byOrder[r.order_id] = items;
  }
  return byOrder;
}

/** Get client's current week orders from orders table. Operator's own implementation. */
export async function operatorGetCurrentOrders(
  clientId: string
): Promise<{ orders: OperatorCurrentOrder[]; error: Error | null }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - day);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  const startStr = startOfWeek.toISOString().split('T')[0];
  const endStr = endOfWeek.toISOString().split('T')[0];

  const { rows, error } = await operatorQuery<{
    id: string;
    order_number: string | number;
    service_type: string;
    status: string;
    scheduled_delivery_date: string | null;
    total_items: number;
    total_value: number;
    notes: string | null;
  }>(
    `SELECT id, order_number, service_type, status, scheduled_delivery_date, total_items, total_value, notes
     FROM orders
     WHERE client_id = ?
       AND status IN ('pending', 'confirmed', 'processing', 'completed', 'waiting_for_proof', 'billing_pending')
       AND scheduled_delivery_date >= ? AND scheduled_delivery_date <= ?
     ORDER BY scheduled_delivery_date ASC, created_at DESC`,
    [clientId, startStr, endStr]
  );
  if (error) return { orders: [], error };
  const orderIds = rows.map((r) => r.id);

  // Fetch item details for Food/Meal and Box orders
  const [foodMealItems, boxItems] = await Promise.all([
    operatorGetOrderItemsForOrders(orderIds),
    operatorGetBoxSelectionsForOrders(orderIds),
  ]);

  const orders: OperatorCurrentOrder[] = rows.map((r) => {
    const items =
      r.service_type === 'Boxes'
        ? boxItems[r.id] ?? []
        : foodMealItems[r.id] ?? [];
    return {
      orderId: r.id,
      orderNumber: String(r.order_number ?? ''),
      serviceType: r.service_type,
      status: r.status,
      scheduledDeliveryDate: r.scheduled_delivery_date ?? null,
      totalItems: r.total_items ?? 0,
      totalValue: r.total_value ?? 0,
      notes: r.notes ?? null,
      items: items.length > 0 ? items : undefined,
    };
  });
  return { orders, error: null };
}

/** Get client's upcoming order from clients.upcoming_order. Operator's own implementation. */
export async function operatorGetClientUpcomingOrder(
  clientId: string
): Promise<{ upcomingOrder: unknown; error: Error | null }> {
  const { rows, error } = await operatorQuery<{ upcoming_order: string | null }>(
    `SELECT upcoming_order FROM clients WHERE id = ? LIMIT 1`,
    [clientId]
  );
  if (error) return { upcomingOrder: null, error };
  const row = rows[0];
  if (!row?.upcoming_order) return { upcomingOrder: null, error: null };
  try {
    const parsed = JSON.parse(row.upcoming_order);
    return { upcomingOrder: parsed, error: null };
  } catch {
    return { upcomingOrder: null, error: null };
  }
}

/** Get item details (name, price) by IDs from menu_items and breakfast_items. */
export async function operatorGetItemDetailsByIds(
  itemIds: string[]
): Promise<Record<string, { name: string; price: number }>> {
  if (itemIds.length === 0) return {};
  const unique = [...new Set(itemIds.filter(Boolean))];
  const placeholders = unique.map(() => '?').join(',');
  const params = [...unique, ...unique];

  const { rows, error } = await operatorQuery<{
    id: string;
    name: string | null;
    price: number;
  }>(
    `SELECT id, name, COALESCE(price_each, 0) AS price FROM menu_items WHERE id IN (${placeholders})
     UNION ALL
     SELECT id, name, COALESCE(price_each, 0) AS price FROM breakfast_items WHERE id IN (${placeholders})`,
    params
  );
  if (error) return {};
  const map: Record<string, { name: string; price: number }> = {};
  for (const r of rows) {
    if (r.id && !map[r.id]) {
      map[r.id] = { name: r.name ?? 'Unknown', price: Number(r.price) ?? 0 };
    }
  }
  return map;
}

/** Get menu items for a vendor. Operator's own implementation. */
export async function operatorGetMenuItemsForVendor(
  vendorId: string
): Promise<{ items: OperatorMenuItem[]; error: Error | null }> {
  const { rows, error } = await operatorQuery<{
    id: string;
    name: string;
    value: number;
    price_each: number | null;
    minimum_order: number;
    delivery_days: string | null;
  }>(
    `SELECT id, name, value, price_each, minimum_order, delivery_days
     FROM menu_items
     WHERE vendor_id = ? AND is_active = 1
     ORDER BY sort_order ASC, name ASC`,
    [vendorId]
  );
  if (error) return { items: [], error };
  const items: OperatorMenuItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name ?? 'Unknown',
    value: r.value ?? 0,
    priceEach: r.price_each ?? undefined,
    minimumOrder: r.minimum_order ?? 0,
    deliveryDays: r.delivery_days
      ? (typeof r.delivery_days === 'string' ? JSON.parse(r.delivery_days) : r.delivery_days) as string[] | null
      : null,
  }));
  return { items, error: null };
}

/** Get all active menu items (for Request Menu when no vendor specified). */
export async function operatorGetAllMenuItems(): Promise<{
  items: OperatorMenuItem[];
  error: Error | null;
}> {
  const { rows, error } = await operatorQuery<{
    id: string;
    vendor_id: string | null;
    name: string;
    value: number;
    price_each: number | null;
    minimum_order: number;
    delivery_days: string | null;
  }>(
    `SELECT id, vendor_id, name, value, price_each, minimum_order, delivery_days
     FROM menu_items
     WHERE is_active = 1
     ORDER BY sort_order ASC, name ASC`
  );
  if (error) return { items: [], error };
  const items: OperatorMenuItem[] = rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id ?? undefined,
    name: r.name ?? 'Unknown',
    value: r.value ?? 0,
    priceEach: r.price_each ?? undefined,
    minimumOrder: r.minimum_order ?? 0,
    deliveryDays: r.delivery_days
      ? (typeof r.delivery_days === 'string' ? JSON.parse(r.delivery_days) : r.delivery_days) as string[] | null
      : null,
  }));
  return { items, error: null };
}

/** Get meal items (breakfast_items). Operator's own implementation. */
export async function operatorGetMealItems(): Promise<{
  items: OperatorMenuItem[];
  error: Error | null;
}> {
  const { rows, error } = await operatorQuery<{
    id: string;
    vendor_id: string | null;
    name: string;
    quota_value: number;
    price_each: number | null;
  }>(
    `SELECT id, vendor_id, name, quota_value, price_each
     FROM breakfast_items
     WHERE is_active = 1
     ORDER BY sort_order ASC, name ASC`
  );
  if (error) return { items: [], error };
  const items: OperatorMenuItem[] = rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id ?? undefined,
    name: r.name ?? 'Unknown',
    value: r.quota_value ?? 1,
    priceEach: r.price_each ?? undefined,
    itemType: 'meal',
  }));
  return { items, error: null };
}

/** Get client's most recent order (for repeat previous order). */
export async function operatorGetLastOrderForClient(
  clientId: string
): Promise<{ order: OperatorLastOrder | null; error: Error | null }> {
  const { rows, error } = await operatorQuery<{
    id: string;
    service_type: string;
    scheduled_delivery_date: string | null;
  }>(
    `SELECT id, service_type, scheduled_delivery_date
     FROM orders
     WHERE client_id = ?
       AND status IN ('pending', 'confirmed', 'processing', 'completed', 'waiting_for_proof', 'billing_pending')
     ORDER BY created_at DESC
     LIMIT 1`,
    [clientId]
  );
  if (error || rows.length === 0) return { order: null, error };
  const orderRow = rows[0];

  // Fetch order items for Food/Meal
  const { rows: vsRows } = await operatorQuery<{ id: string; vendor_id: string }>(
    `SELECT id, vendor_id FROM order_vendor_selections WHERE order_id = ?`,
    [orderRow.id]
  );

  const itemsByVendor: Record<string, Record<string, number>> = {};
  for (const vs of vsRows) {
    const { rows: itemRows } = await operatorQuery<{
      menu_item_id: string | null;
      meal_item_id: string | null;
      quantity: number;
    }>(
      `SELECT menu_item_id, meal_item_id, quantity FROM order_items WHERE vendor_selection_id = ?`,
      [vs.id]
    );
    const items: Record<string, number> = {};
    for (const it of itemRows) {
      const itemId = it.menu_item_id ?? it.meal_item_id;
      if (itemId) items[itemId] = (items[itemId] ?? 0) + it.quantity;
    }
    if (vs.vendor_id) itemsByVendor[vs.vendor_id] = items;
  }

  // Box selections
  let boxOrders: { boxTypeId?: string; vendorId?: string; quantity: number; items?: Record<string, number> }[] = [];
  if (orderRow.service_type === 'Boxes') {
    const { rows: boxRows } = await operatorQuery<{
      box_type_id: string | null;
      vendor_id: string | null;
      quantity: number;
      items: string | null;
    }>(
      `SELECT box_type_id, vendor_id, quantity, items FROM order_box_selections WHERE order_id = ?`,
      [orderRow.id]
    );
    boxOrders = boxRows.map((b) => {
      let itemsObj: Record<string, number> = {};
      if (b.items) {
        try {
          const parsed = JSON.parse(b.items);
          itemsObj = typeof parsed === 'object' ? parsed : {};
        } catch {}
      }
      return {
        boxTypeId: b.box_type_id ?? undefined,
        vendorId: b.vendor_id ?? undefined,
        quantity: b.quantity ?? 1,
        items: Object.keys(itemsObj).length ? itemsObj : undefined,
      };
    });
  }

  const vendorSelections =
    Object.keys(itemsByVendor).length > 0
      ? Object.entries(itemsByVendor).map(([vendorId, items]) => ({ vendorId, items }))
      : undefined;

  return {
    order: {
      orderId: orderRow.id,
      serviceType: orderRow.service_type,
      scheduledDeliveryDate: orderRow.scheduled_delivery_date ?? null,
      vendorSelections,
      boxOrders: boxOrders.length ? boxOrders : undefined,
    },
    error: null,
  };
}

/** Append to client order_history. Operator's own implementation. */
export async function operatorAppendOrderHistory(
  clientId: string,
  entry: unknown,
  maxEntries: number = 50
): Promise<{ error: Error | null }> {
  const { rows, error: fetchErr } = await operatorQuery<{ order_history: string | null }>(
    `SELECT order_history FROM clients WHERE id = ? LIMIT 1`,
    [clientId]
  );
  if (fetchErr) return { error: fetchErr };
  const row = rows[0];
  let history: unknown[] = [];
  if (row?.order_history) {
    try {
      const parsed = JSON.parse(row.order_history);
      history = Array.isArray(parsed) ? parsed : [];
    } catch {
      history = [];
    }
  }
  history = [entry, ...history].slice(0, maxEntries);
  const { error } = await operatorQuery(
    `UPDATE clients SET order_history = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [JSON.stringify(history), clientId]
  );
  return { error };
}
