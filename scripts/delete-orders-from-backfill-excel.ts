/**
 * Delete all orders listed in a Backfill Excel file (Client Name, Vendor, Order Number).
 * Use when you need to undo orders created by the backfill script.
 *
 * Run:
 *   npx tsx scripts/delete-orders-from-backfill-excel.ts path/to/Backfill_Orders_2026-02-22_to_2026-02-28.xlsx
 *   npx tsx scripts/delete-orders-from-backfill-excel.ts Backfill_Orders_2026-02-22_to_2026-02-28.xlsx --dry-run
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey || !supabaseUrl) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const fileArg = args.find((a) => !a.startsWith('--'));

if (!fileArg) {
  console.error('Usage: npx tsx scripts/delete-orders-from-backfill-excel.ts <path-to-backfill.xlsx> [--dry-run]');
  process.exit(1);
}

const filePath = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);

async function main() {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
  } catch (e) {
    console.error('Failed to read file:', filePath, (e as Error).message);
    process.exit(1);
  }

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

  const orderNumbers: number[] = [];
  for (const row of rows) {
    const num = row['Order Number'];
    if (num === undefined || num === null || num === '-' || num === '') continue;
    const n = typeof num === 'number' ? num : parseInt(String(num), 10);
    if (!isNaN(n) && n > 0) orderNumbers.push(n);
  }

  if (orderNumbers.length === 0) {
    console.log('No order numbers found in the Excel file (or only placeholder row).');
    return;
  }

  const unique = [...new Set(orderNumbers)];
  console.log(`Found ${unique.length} order number(s) to delete: ${unique.slice(0, 10).join(', ')}${unique.length > 10 ? '...' : ''}`);

  if (DRY_RUN) {
    console.log('DRY RUN - no deletes performed.');
    return;
  }

  const { data: orders, error: fetchErr } = await supabase
    .from('orders')
    .select('id, order_number, client_id, service_type, scheduled_delivery_date')
    .in('order_number', unique);

  if (fetchErr) {
    console.error('Error fetching orders:', fetchErr.message);
    process.exit(1);
  }

  const found = (orders || []) as { id: string; order_number: number; client_id: string; service_type: string; scheduled_delivery_date: string }[];
  const notFound = unique.filter((n) => !found.some((o) => o.order_number === n));
  if (notFound.length > 0) {
    console.warn('Order number(s) not found in DB (may already be deleted):', notFound.join(', '));
  }

  for (const order of found) {
    const { error: delErr } = await supabase.from('orders').delete().eq('id', order.id);
    if (delErr) {
      console.error(`Failed to delete order ${order.order_number} (${order.id}):`, delErr.message);
    } else {
      console.log(`Deleted order #${order.order_number} (${order.service_type}, ${order.scheduled_delivery_date})`);
    }
  }

  console.log(`Done. Deleted ${found.length} order(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
