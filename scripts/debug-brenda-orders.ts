/**
 * Why aren't BRENDA FALKOWITZ's 4 orders (108917, 108916, 108915, 107620) found by the backfill?
 * Run: npx tsx scripts/debug-brenda-orders.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const ORDER_NUMBERS = [108917, 108916, 108915, 107620];
const WEEK_START = '2026-02-22';
const WEEK_END = '2026-02-28T23:59:59.999';

async function main() {
  const { data: brenda, error: e0 } = await supabase
    .from('clients')
    .select('id, full_name, parent_client_id')
    .ilike('full_name', '%BRENDA FALKOWITZ%')
    .limit(5);

  console.log('--- Clients matching BRENDA FALKOWITZ ---');
  if (e0) {
    console.error(e0);
    return;
  }
  console.log(brenda || []);

  const brendaId = (brenda || [])[0]?.id;
  if (!brendaId) {
    console.log('No client found.');
    return;
  }
  console.log('\nBrenda client id (first match):', brendaId);
  console.log('parent_client_id:', (brenda || [])[0]?.parent_client_id ?? 'null (is parent)');

  console.log('\n--- Orders by order_number', ORDER_NUMBERS, '---');
  const { data: orders, error: e1 } = await supabase
    .from('orders')
    .select('id, order_number, client_id, service_type, scheduled_delivery_date')
    .in('order_number', ORDER_NUMBERS);

  if (e1) {
    console.error(e1);
    return;
  }
  console.log('Found', (orders || []).length, 'orders');
  (orders || []).forEach((o: any) => {
    const dateStr = o.scheduled_delivery_date ? String(o.scheduled_delivery_date).slice(0, 10) : '';
    const inWeek = dateStr >= WEEK_START && dateStr <= WEEK_START.slice(0, 10);
    console.log('  order_number:', o.order_number, '| client_id:', o.client_id, '| service_type:', o.service_type, '| date:', o.scheduled_delivery_date, '| in week 22-28?', dateStr >= '2026-02-22' && dateStr <= '2026-02-28');
  });

  console.log('\n--- All Meal orders in week for client_id =', brendaId, '---');
  const { data: weekOrders, error: e2 } = await supabase
    .from('orders')
    .select('id, order_number, client_id, service_type, scheduled_delivery_date')
    .eq('client_id', brendaId)
    .eq('service_type', 'Meal')
    .gte('scheduled_delivery_date', WEEK_START)
    .lte('scheduled_delivery_date', WEEK_END);

  if (e2) {
    console.error(e2);
    return;
  }
  console.log('Found', (weekOrders || []).length, 'Meal orders');
  (weekOrders || []).forEach((o: any) => console.log('  order_number:', o.order_number, '| date:', o.scheduled_delivery_date));

  console.log('\n--- Conclusion ---');
  const foundOrderNumbers = new Set((orders || []).map((o: any) => o.order_number));
  const missing = ORDER_NUMBERS.filter((n) => !foundOrderNumbers.has(n));
  if (missing.length) console.log('Order numbers NOT in DB:', missing);
  const wrongClient = (orders || []).filter((o: any) => o.client_id !== brendaId);
  if (wrongClient.length) console.log('Orders with different client_id than Brenda:', wrongClient.map((o: any) => ({ order_number: o.order_number, client_id: o.client_id })));
  const notMeal = (orders || []).filter((o: any) => o.service_type !== 'Meal');
  if (notMeal.length) console.log('Orders that are not Meal:', notMeal.map((o: any) => ({ order_number: o.order_number, service_type: o.service_type })));
  const outOfWeek = (orders || []).filter((o: any) => {
    const d = o.scheduled_delivery_date ? String(o.scheduled_delivery_date).slice(0, 10) : '';
    return d < '2026-02-22' || d > '2026-02-28';
  });
  if (outOfWeek.length) console.log('Orders outside week 22-28:', outOfWeek.map((o: any) => ({ order_number: o.order_number, date: o.scheduled_delivery_date })));
}

main();
