/**
 * MySQL database client with Supabase-compatible API.
 * Drop-in replacement for @supabase/supabase-js to migrate from Supabase (PostgreSQL) to MySQL.
 */

import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';

// Connection config from environment
const config = {
    host: process.env.MYSQL_HOST || process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || process.env.DATABASE_PORT || '3306', 10),
    user: process.env.MYSQL_USER || process.env.DATABASE_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.DATABASE_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || process.env.DATABASE_NAME || 'triangle_orders',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
};

let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
    if (!pool) {
        pool = mysql.createPool(config);
    }
    return pool;
}

export interface DbError {
    message: string;
    code?: string;
    details?: string;
}

export interface QueryResult<T = any> {
    data: T | null;
    error: DbError | null;
    count?: number | null;
    status?: number;
    statusText?: string;
}

function escapeId(name: string): string {
    return '`' + String(name).replace(/`/g, '``') + '`';
}

function escapeValue(val: any): string {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? '1' : '0';
    if (typeof val === 'number') return String(val);
    if (val instanceof Date) return "'" + val.toISOString().slice(0, 19).replace('T', ' ') + "'";
    if (typeof val === 'object') return "'" + escapeString(JSON.stringify(val)) + "'";
    return "'" + escapeString(String(val)) + "'";
}

function escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\0/g, '\\0').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/**
 * Convert a value to a MySQL-safe parameter for prepared statements.
 * Fixes "Incorrect arguments to mysqld_stmt_execute" when passing objects/arrays
 * or types that mysql2's binding doesn't handle correctly.
 */
function toSqlParam(val: any): any {
    if (val === null || val === undefined) return null;
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'number') return Number.isFinite(val) ? val : null;
    if (typeof val === 'string') return val;
    if (val instanceof Date) return val.toISOString().slice(0, 19).replace('T', ' ');
    if (typeof val === 'object') return JSON.stringify(val);
    if (typeof val === 'bigint') return Number(val);
    return String(val);
}

type QueryBuilder = {
    _table: string;
    _select: string;
    _selectOpts?: { count?: string; head?: boolean };
    _wheres: string[];
    _params: any[];
    _orderBy: { col: string; asc: boolean }[];
    _limitVal?: number;
    _offsetVal?: number;
    _single: boolean;
    _maybeSingle: boolean;
    _count: boolean;
    _insertData?: any[];
    _updateData?: any;
    _delete: boolean;
};

function createBuilder(table: string): QueryBuilder {
    return {
        _table: table,
        _select: '*',
        _wheres: [],
        _params: [],
        _orderBy: [],
        _limitVal: undefined,
        _offsetVal: undefined,
        _single: false,
        _maybeSingle: false,
        _count: false,
        _insertData: undefined,
        _updateData: undefined,
        _delete: false,
        _selectOpts: undefined,
    };
}

/** Split select string by comma, respecting nested parentheses (e.g. vendor_locations (id, locations (name))) */
function splitSelectParts(select: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    for (const char of select) {
        if (char === '(') {
            depth++;
            current += char;
        } else if (char === ')') {
            depth--;
            current += char;
        } else if (char === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

function cloneBuilder(b: QueryBuilder): QueryBuilder {
    return {
        _table: b._table,
        _select: b._select,
        _wheres: [...b._wheres],
        _params: [...b._params],
        _orderBy: [...b._orderBy],
        _limitVal: b._limitVal,
        _offsetVal: b._offsetVal,
        _single: b._single,
        _maybeSingle: b._maybeSingle,
        _count: b._count,
        _insertData: b._insertData,
        _updateData: b._updateData,
        _delete: b._delete,
        _selectOpts: b._selectOpts,
    };
}

function buildSelectSQL(b: QueryBuilder): { sql: string; params: any[]; joinTransform?: (row: any) => any } {
    const table = escapeId(b._table);
    const tableAlias = b._table === 'orders' ? 'o' : b._table === 'vendor_locations' ? 'vl' : b._table;
    const tableQualified = b._table === 'orders' ? `${escapeId(b._table)} ${tableAlias}` : b._table === 'vendor_locations' ? `${escapeId(b._table)} ${tableAlias}` : escapeId(b._table);
    const selectParts = splitSelectParts(b._select);
    const embedMatch = selectParts.find(s => s.includes('clients(full_name)'));
    const locationsEmbedMatch = selectParts.find(s => /\blocations\s*\(\s*name\s*\)/.test(s));
    let selectRaw: string;
    let joinClause = '';
    let joinTransform: ((row: any) => any) | undefined;
    if (embedMatch && b._table === 'orders' && !b._count) {
        selectRaw = `${tableAlias}.*, c.full_name AS clients_full_name`;
        joinClause = ` LEFT JOIN clients c ON ${tableAlias}.client_id = c.id`;
        joinTransform = (row: any) => {
            const { clients_full_name, ...rest } = row;
            return { ...rest, clients: clients_full_name != null ? { full_name: clients_full_name } : null };
        };
    } else if (locationsEmbedMatch && b._table === 'vendor_locations' && !b._count) {
        const baseCols = selectParts.filter(s => !s.includes('(')).map(s => s.trim());
        const prefixedBase = baseCols.length ? baseCols.map(c => `${tableAlias}.${escapeId(c)}`).join(', ') : `${tableAlias}.*`;
        selectRaw = `${prefixedBase}, l.name AS locations_name`;
        joinClause = ` LEFT JOIN locations l ON ${tableAlias}.location_id = l.id`;
        joinTransform = (row: any) => {
            const { locations_name, ...rest } = row;
            return { ...rest, locations: locations_name != null ? { name: locations_name } : null };
        };
    } else {
        selectRaw = selectParts.filter(s => !s.includes('(')).join(', ') || '*';
    }
    const select = b._count ? 'COUNT(*)' : selectRaw;
    let sql = `SELECT ${select} FROM ${tableQualified}${joinClause}`;
    const params: any[] = [];
    if (b._wheres.length > 0) {
        sql += ' WHERE ' + b._wheres.join(' AND ');
        params.push(...b._params);
    }
    if (b._orderBy.length > 0 && !b._count) {
        const prefix = joinClause ? `${tableAlias}.` : '';
        const orderClauses = b._orderBy.map(o => `${prefix}${escapeId(o.col)} ${o.asc ? 'ASC' : 'DESC'}`);
        sql += ' ORDER BY ' + orderClauses.join(', ');
    }
    if (b._limitVal !== undefined && !b._count) {
        sql += ' LIMIT ?';
        params.push(b._limitVal);
    }
    if (b._offsetVal !== undefined && !b._count) {
        sql += ' OFFSET ?';
        params.push(b._offsetVal);
    }
    return { sql, params, joinTransform };
}

async function executeSelect(b: QueryBuilder): Promise<QueryResult> {
    const pool = getPool();
    try {
        if (b._selectOpts?.count && b._selectOpts?.head) {
            const countB = { ...b, _select: '*', _count: true, _limitVal: undefined, _offsetVal: undefined };
            const { sql, params } = buildSelectSQL(countB);
            const [rows] = await pool.execute(sql, params);
            const arr = Array.isArray(rows) ? rows : [];
            const count = arr[0] && ((arr[0] as any)['COUNT(*)'] ?? (arr[0] as any).count) != null
                ? Number((arr[0] as any)['COUNT(*)'] ?? (arr[0] as any).count)
                : 0;
            return { data: null, error: null, count };
        }
        const { sql, params, joinTransform } = buildSelectSQL(b);
        const [rows] = await pool.execute(sql, params);
        let arr = Array.isArray(rows) ? rows : [];
        if (joinTransform && arr.length > 0) {
            arr = arr.map((r: any) => joinTransform!(r));
        }
        // Embed vendor_locations for vendors table (when select includes vendor_locations)
        const vendorsEmbedMatch = b._table === 'vendors' && b._select.includes('vendor_locations');
        if (vendorsEmbedMatch && arr.length > 0 && !b._count) {
            const vendorIds = arr.map((r: any) => r.id).filter(Boolean);
            if (vendorIds.length > 0) {
                const placeholders = vendorIds.map(() => '?').join(',');
                const [vlRows] = await pool.execute(
                    `SELECT vl.id, vl.vendor_id, vl.location_id, l.name AS locations_name
                     FROM vendor_locations vl
                     LEFT JOIN locations l ON vl.location_id = l.id
                     WHERE vl.vendor_id IN (${placeholders})`,
                    vendorIds
                );
                const vlArr = Array.isArray(vlRows) ? vlRows : [];
                const byVendor = new Map<string, any[]>();
                for (const vl of vlArr as any[]) {
                    const list = byVendor.get(vl.vendor_id) || [];
                    list.push({
                        id: vl.id,
                        location_id: vl.location_id,
                        locations: vl.locations_name != null ? { name: vl.locations_name } : null
                    });
                    byVendor.set(vl.vendor_id, list);
                }
                arr = arr.map((r: any) => ({
                    ...r,
                    vendor_locations: byVendor.get(r.id) || []
                }));
            }
        }
        if (b._count) {
            const count = arr[0] && typeof (arr[0] as any)['COUNT(*)'] !== 'undefined'
                ? (arr[0] as any)['COUNT(*)']
                : arr[0] && (arr[0] as any).count !== undefined
                    ? (arr[0] as any).count
                    : 0;
            return { data: null, error: null, count: Number(count) };
        }
        if (b._single || b._maybeSingle) {
            if (arr.length === 0) {
                if (b._single) {
                    return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
                }
                return { data: null, error: null };
            }
            if (arr.length > 1 && b._single) {
                return { data: null, error: { message: 'Multiple rows found', code: 'PGRST116' } };
            }
            return { data: arr[0] as any, error: null };
        }
        return { data: arr as any[], error: null };
    } catch (err: any) {
        return {
            data: null,
            error: {
                message: err?.message || 'Database error',
                code: err?.code,
                details: err?.sql,
            },
        };
    }
}

async function executeInsert(b: QueryBuilder): Promise<QueryResult> {
    const pool = getPool();
    const data = b._insertData;
    if (!data || !Array.isArray(data) || data.length === 0) {
        return { data: null, error: { message: 'No insert data' } };
    }
    const table = escapeId(b._table);
    const row = { ...data[0] };
    if (!row.id && b._table !== 'order_number_seq') {
        row.id = randomUUID();
    }
    const cols = Object.keys(row).filter(k => row[k] !== undefined);
    const colsEscaped = cols.map(escapeId).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const values = cols.map(c => toSqlParam(row[c]));
    try {
        await pool.execute(
            `INSERT INTO ${table} (${colsEscaped}) VALUES (${placeholders})`,
            values
        );
        const id = row.id;
        const selectCols = b._select === '*' ? '*' : b._select;
        let arr: any[];
        if (b._table === 'vendor_locations' && /\blocations\s*\(\s*name\s*\)/.test(selectCols)) {
            const [rows] = await pool.execute(
                `SELECT vl.id, vl.vendor_id, vl.location_id, l.name AS locations_name
                 FROM ${table} vl
                 LEFT JOIN locations l ON vl.location_id = l.id
                 WHERE vl.id = ? LIMIT 1`,
                [id]
            );
            arr = Array.isArray(rows) ? rows : [];
            if (arr[0]) {
                const { locations_name, ...rest } = arr[0];
                arr[0] = { ...rest, locations: locations_name != null ? { name: locations_name } : null };
            }
        } else {
            const plainSelect = selectCols.split(',').map((s: string) => s.trim()).filter((s: string) => !s.includes('(')).join(', ') || '*';
            const [rows] = await pool.execute(
                `SELECT ${plainSelect} FROM ${table} WHERE id = ? LIMIT 1`,
                [id]
            );
            arr = Array.isArray(rows) ? rows : [];
        }
        return { data: arr[0] as any, error: null };
    } catch (err: any) {
        return {
            data: null,
            error: {
                message: err?.message || 'Insert failed',
                code: err?.code,
                details: err?.sql,
            },
        };
    }
}

async function executeUpdate(b: QueryBuilder): Promise<QueryResult> {
    const pool = getPool();
    const data = b._updateData;
    if (!data || typeof data !== 'object') {
        return { data: null, error: { message: 'No update data' } };
    }
    const table = escapeId(b._table);
    const keys = Object.keys(data).filter(k => data[k] !== undefined);
    const sets = keys.map(k => `${escapeId(k)} = ?`);
    const values = keys.map(k => toSqlParam(data[k]));
    if (sets.length === 0) {
        return { data: null, error: null };
    }
    const whereClause = b._wheres.length > 0 ? ' WHERE ' + b._wheres.join(' AND ') : '';
    const params = [...values, ...b._params.map(toSqlParam)];
    try {
        await pool.execute(`UPDATE ${table} SET ${sets.join(', ')}${whereClause}`, params);
        return { data: null, error: null };
    } catch (err: any) {
        return {
            data: null,
            error: {
                message: err?.message || 'Update failed',
                code: err?.code,
                details: err?.sql,
            },
        };
    }
}

async function executeDelete(b: QueryBuilder): Promise<QueryResult> {
    const pool = getPool();
    const table = escapeId(b._table);
    const whereClause = b._wheres.length > 0 ? ' WHERE ' + b._wheres.join(' AND ') : '';
    const params = b._params.map(toSqlParam);
    try {
        await pool.execute(`DELETE FROM ${table}${whereClause}`, params);
        return { data: null, error: null };
    } catch (err: any) {
        return {
            data: null,
            error: {
                message: err?.message || 'Delete failed',
                code: err?.code,
                details: err?.sql,
            },
        };
    }
}

function createChain(b: QueryBuilder) {
    const chain: any = {
        select(columns: string = '*', opts?: { count?: string; head?: boolean }) {
            const next = cloneBuilder(b);
            next._select = columns;
            next._selectOpts = opts;
            return createChain(next);
        },
        ilike(column: string, pattern: string) {
            const next = cloneBuilder(b);
            next._wheres.push(`LOWER(${escapeId(column)}) LIKE LOWER(?)`);
            next._params.push(pattern);
            return createChain(next);
        },
        neq(column: string, value: any) {
            const next = cloneBuilder(b);
            next._wheres.push(`${escapeId(column)} != ?`);
            next._params.push(value);
            return createChain(next);
        },
        or(condition: string) {
            const next = cloneBuilder(b);
            const parts: string[] = [];
            const orParams: any[] = [];
            for (const part of condition.split(',')) {
                const p = part.trim();
                const inMatch = p.match(/^(\w+)\.in\.\((.+)\)$/);
                if (inMatch) {
                    const col = inMatch[1];
                    const vals = inMatch[2].split(',').map((v: string) => v.trim());
                    if (vals.length > 0) {
                        parts.push(`${escapeId(col)} IN (${vals.map(() => '?').join(',')})`);
                        orParams.push(...vals);
                    }
                } else {
                    const ilikeMatch = p.match(/^(\w+)\.ilike\.(.+)$/);
                    if (ilikeMatch) {
                        parts.push(`LOWER(${escapeId(ilikeMatch[1])}) LIKE LOWER(?)`);
                        orParams.push(ilikeMatch[2]);
                    }
                }
            }
            if (parts.length > 0) {
                next._wheres.push('(' + parts.join(' OR ') + ')');
                next._params.push(...orParams);
            }
            return createChain(next);
        },
        eq(column: string, value: any) {
            const next = cloneBuilder(b);
            next._wheres.push(`${escapeId(column)} = ?`);
            next._params.push(value);
            return createChain(next);
        },
        gte(column: string, value: any) {
            const next = cloneBuilder(b);
            next._wheres.push(`${escapeId(column)} >= ?`);
            next._params.push(value);
            return createChain(next);
        },
        lte(column: string, value: any) {
            const next = cloneBuilder(b);
            next._wheres.push(`${escapeId(column)} <= ?`);
            next._params.push(value);
            return createChain(next);
        },
        not(column: string, op: string, value: any) {
            const next = cloneBuilder(b);
            if (op === 'is' && value === null) {
                next._wheres.push(`${escapeId(column)} IS NOT NULL`);
            } else {
                next._wheres.push(`${escapeId(column)} != ?`);
                next._params.push(value);
            }
            return createChain(next);
        },
        in(column: string, values: any[]) {
            const next = cloneBuilder(b);
            if (!values || values.length === 0) {
                next._wheres.push('1=0');
            } else {
                next._wheres.push(`${escapeId(column)} IN (${values.map(() => '?').join(',')})`);
                next._params.push(...values);
            }
            return createChain(next);
        },
        order(column: string, opts?: { ascending?: boolean }) {
            const next = cloneBuilder(b);
            next._orderBy.push({ col: column, asc: opts?.ascending !== false });
            return createChain(next);
        },
        limit(n: number) {
            const next = cloneBuilder(b);
            next._limitVal = n;
            return createChain(next);
        },
        range(from: number, to: number) {
            const next = cloneBuilder(b);
            next._limitVal = to - from + 1;
            next._offsetVal = from;
            return createChain(next);
        },
        single() {
            const next = cloneBuilder(b);
            next._single = true;
            if (next._limitVal === undefined) next._limitVal = 2;
            return createChain(next);
        },
        maybeSingle() {
            const next = cloneBuilder(b);
            next._maybeSingle = true;
            if (next._limitVal === undefined) next._limitVal = 2;
            return createChain(next);
        },
        count(mode?: 'exact' | 'planned' | 'estimated') {
            const next = cloneBuilder(b);
            next._count = true;
            next._select = '*';
            return createChain(next);
        },
        insert(data: any[] | any) {
            const next = cloneBuilder(b);
            next._insertData = Array.isArray(data) ? data : [data];
            return createChain(next);
        },
        update(data: any) {
            const next = cloneBuilder(b);
            next._updateData = data;
            return createChain(next);
        },
        delete() {
            const next = cloneBuilder(b);
            next._delete = true;
            return createChain(next);
        },
        then(resolve: (r: QueryResult) => void, reject?: (e: any) => void) {
            const run = async () => {
                if (b._insertData) return executeInsert(b);
                if (b._updateData) return executeUpdate(b);
                if (b._delete) return executeDelete(b);
                return executeSelect(b);
            };
            return run().then(resolve, reject);
        },
    };
    return chain;
}

export function from(table: string) {
    return createChain(createBuilder(table));
}

// RPC replacements - implement as SQL since MySQL stored procedures differ from PostgreSQL
export async function rpcGetVendorDeliveryDateSummary(pVendorId: string): Promise<QueryResult> {
    const pool = getPool();
    try {
        const [rows] = await pool.execute(
            `SELECT o.scheduled_delivery_date AS scheduled_delivery_date,
                    COUNT(*) AS order_count,
                    COALESCE(SUM(o.total_items), 0) AS total_items
             FROM orders o
             WHERE (EXISTS (SELECT 1 FROM order_vendor_selections ovs WHERE ovs.order_id = o.id AND ovs.vendor_id = ?)
                    OR EXISTS (SELECT 1 FROM order_box_selections obs WHERE obs.order_id = o.id AND obs.vendor_id = ?)
                    OR (o.service_type = 'Equipment' AND o.notes IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(o.notes, '$.vendorId')) = ?))
             GROUP BY o.scheduled_delivery_date
             ORDER BY o.scheduled_delivery_date DESC`,
            [pVendorId, pVendorId, pVendorId]
        );
        return { data: rows as any[], error: null };
    } catch (err: any) {
        return {
            data: null,
            error: { message: err?.message || 'RPC failed', code: err?.code },
        };
    }
}

export async function rpcGetOrdersByVendorAndDate(
    pVendorId: string,
    pDeliveryDate: string | null
): Promise<QueryResult> {
    const pool = getPool();
    try {
        let sql = `SELECT o.* FROM orders o
                   WHERE (
                     (? IS NOT NULL AND o.scheduled_delivery_date = ?)
                     OR (? IS NULL AND o.scheduled_delivery_date IS NULL)
                   )
                   AND (
                     EXISTS (SELECT 1 FROM order_vendor_selections ovs WHERE ovs.order_id = o.id AND ovs.vendor_id = ?)
                     OR EXISTS (SELECT 1 FROM order_box_selections obs WHERE obs.order_id = o.id AND obs.vendor_id = ?)
                     OR (o.service_type = 'Equipment' AND o.notes IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(o.notes, '$.vendorId')) = ?)
                   )
                   ORDER BY o.created_at DESC`;
        const [rows] = await pool.execute(sql, [
            pDeliveryDate,
            pDeliveryDate,
            pDeliveryDate,
            pVendorId,
            pVendorId,
            pVendorId,
        ]);
        return { data: rows as any[], error: null };
    } catch (err: any) {
        return {
            data: null,
            error: { message: err?.message || 'RPC failed', code: err?.code },
        };
    }
}

export async function rpcAppendClientOrderHistory(
    pClientId: string,
    pNewEntry: any,
    pMaxEntries: number = 50
): Promise<QueryResult> {
    const pool = getPool();
    try {
        const [rows] = await pool.execute(
            'SELECT order_history FROM clients WHERE id = ? LIMIT 1',
            [pClientId]
        );
        const arr = Array.isArray(rows) ? rows : [];
        const existing = arr[0] as any;
        const history = existing?.order_history;
        let arrHistory: any[] = [];
        if (history) {
            try {
                arrHistory = typeof history === 'string' ? JSON.parse(history) : Array.isArray(history) ? history : [];
            } catch {
                arrHistory = [];
            }
        }
        arrHistory = [pNewEntry, ...arrHistory].slice(0, pMaxEntries);
        await pool.execute('UPDATE clients SET order_history = ? WHERE id = ?', [
            JSON.stringify(arrHistory),
            pClientId,
        ]);
        return { data: null, error: null };
    } catch (err: any) {
        return {
            data: null,
            error: {
                message: err?.message || 'append_client_order_history failed',
                code: err?.code,
            },
        };
    }
}

function createRpcChain(name: string, params: Record<string, any>) {
    let rangeFrom: number | undefined;
    let rangeTo: number | undefined;
    const chain = {
        range(from: number, to: number) {
            rangeFrom = from;
            rangeTo = to;
            return chain;
        },
        then(resolve: (r: QueryResult) => void, reject?: (e: any) => void) {
            const run = async () => {
                let result: QueryResult;
                if (name === 'get_vendor_delivery_date_summary') {
                    result = await rpcGetVendorDeliveryDateSummary(params.p_vendor_id);
                } else if (name === 'get_orders_by_vendor_and_date') {
                    result = await rpcGetOrdersByVendorAndDate(
                        params.p_vendor_id,
                        params.p_delivery_date || null
                    );
                } else if (name === 'append_client_order_history') {
                    result = await rpcAppendClientOrderHistory(
                        params.p_client_id,
                        params.p_new_entry,
                        params.p_max_entries
                    );
                } else {
                    result = { data: null, error: { message: `Unknown RPC: ${name}` } };
                }
                if (result.data && Array.isArray(result.data) && rangeFrom !== undefined && rangeTo !== undefined) {
                    result = { ...result, data: result.data.slice(rangeFrom, rangeTo + 1) };
                }
                return result;
            };
            return run().then(resolve, reject);
        },
    };
    return chain;
}

export const db = {
    from,
    rpc: (name: string, params: Record<string, any>) => createRpcChain(name, params),
};

export default db;
