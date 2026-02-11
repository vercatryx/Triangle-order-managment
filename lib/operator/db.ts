/**
 * Operator's own DB client. Uses mysql2 directly.
 * Does NOT import from lib/db or lib/supabase.
 * Uses same env vars: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.
 */

import mysql from 'mysql2/promise';

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
