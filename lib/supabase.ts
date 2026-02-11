/**
 * Database client - uses MySQL (replaces Supabase/PostgreSQL).
 * Exports a Supabase-compatible API for drop-in replacement.
 */

import { db } from './db';

// Export as 'supabase' for backward compatibility - all imports of supabase will use MySQL
export const supabase = db;

/** createClient returns the same db (no anon vs service role in MySQL - full access) */
export function createClient(_url?: string, _key?: string, _opts?: any) {
    return db;
}
