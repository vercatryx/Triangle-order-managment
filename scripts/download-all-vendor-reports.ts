/**
 * Download all Excel reports and label PDFs for all vendors for a date range
 * (e.g. a full week). Output is organized by date, then by vendor.
 *
 * Run (examples):
 *   npx tsx scripts/download-all-vendor-reports.ts --week=2026-02-24
 *   npx tsx scripts/download-all-vendor-reports.ts --week-start=2026-02-22 --week-end=2026-02-28
 *   npx tsx scripts/download-all-vendor-reports.ts --week=2026-02-24 --output=./my-reports
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { getWeekStart } from '../lib/weekly-lock';
import { generateLabelsPDF } from '../lib/label-utils';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey || !supabaseUrl) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1]?.trim() : undefined;
};
const weekStartArg = getArg('week-start');
const weekEndArg = getArg('week-end');
const weekArg = getArg('week');
const outputDirArg = getArg('output') ?? 'vendor-reports';

let weekStartStr: string;
let weekEndStr: string;
if (weekStartArg && weekEndArg) {
  weekStartStr = weekStartArg;
  weekEndStr = weekEndArg;
} else if (weekArg) {
  const d = new Date(weekArg + 'T12:00:00');
  if (isNaN(d.getTime())) {
    console.error('Invalid --week= date (use YYYY-MM-DD)');
    process.exit(1);
  }
  const start = getWeekStart(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  weekStartStr = start.toISOString().split('T')[0];
  weekEndStr = end.toISOString().split('T')[0];
} else {
  console.error('Provide --week=YYYY-MM-DD or --week-start and --week-end');
  process.exit(1);
}

const weekStartDate = new Date(weekStartStr + 'T00:00:00');
const weekEndDate = new Date(weekEndStr + 'T23:59:59');
if (weekStartDate > weekEndDate) {
  console.error('week-start must be <= week-end');
  process.exit(1);
}

/** All dates in [weekStartStr, weekEndStr] inclusive (YYYY-MM-DD). */
function datesInRange(): string[] {
  const out: string[] = [];
  const d = new Date(weekStartDate);
  while (d <= weekEndDate) {
    out.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Sanitize for folder name: no slashes, short id suffix for uniqueness. */
function vendorFolderName(vendor: { name: string; id: string }): string {
  const safe = (vendor.name || 'Vendor').replace(/[/\\?*:"]/g, '-').trim() || 'Vendor';
  const shortId = vendor.id.slice(0, 8);
  return `${safe} (${shortId})`;
}

// --- Reference data types ---
type ClientRow = { id: string; full_name: string | null; address: string | null; phone_number: string | null };
type MenuItemRow = { id: string; name: string; category_id: string | null };
type CategoryRow = { id: string; name: string };
type BoxTypeRow = { id: string; name: string };
type MealItemRow = { id: string; name: string; category_id: string | null };

// --- Load reference data once ---
async function loadReferenceData() {
  const [
    vendorsRes,
    clientsRes,
    menuRes,
    categoriesRes,
    boxTypesRes,
    breakfastRes,
  ] = await Promise.all([
    supabase.from('vendors').select('id, name').eq('is_active', true),
    supabase.from('clients').select('id, full_name, address, phone_number'),
    supabase.from('menu_items').select('id, name, category_id'),
    supabase.from('item_categories').select('id, name').order('sort_order').order('name'),
    supabase.from('box_types').select('id, name'),
    supabase.from('breakfast_items').select('id, name, category_id').order('sort_order').order('name'),
  ]);

  if (vendorsRes.error) throw new Error('Failed to load vendors: ' + vendorsRes.error.message);
  if (clientsRes.error) throw new Error('Failed to load clients: ' + clientsRes.error.message);

  const clients = (clientsRes.data || []) as ClientRow[];
  const menuItems = (menuRes.data || []) as MenuItemRow[];
  const categories = (categoriesRes.data || []) as CategoryRow[];
  const boxTypes = (boxTypesRes.data || []) as BoxTypeRow[];
  const mealItems = (breakfastRes.data || []) as MealItemRow[];

  const clientMap = new Map<string, ClientRow>();
  clients.forEach((c) => clientMap.set(c.id, c));

  return {
    vendors: (vendorsRes.data || []) as { id: string; name: string }[],
    clientMap,
    menuItems,
    categories,
    boxTypes,
    mealItems,
  };
}

function getClientName(clientMap: Map<string, ClientRow>, clientId: string): string {
  const c = clientMap.get(clientId);
  return c?.full_name ?? 'Unknown Client';
}

function getClientAddress(clientMap: Map<string, ClientRow>, clientId: string): string {
  const c = clientMap.get(clientId);
  return c?.address ?? '-';
}

function getClientPhone(clientMap: Map<string, ClientRow>, clientId: string): string {
  const c = clientMap.get(clientId);
  return c?.phone_number ?? '-';
}

function getCategoryName(
  categories: CategoryRow[],
  categoryId: string | null | undefined
): string {
  if (!categoryId) return 'Uncategorized';
  const c = categories.find((x) => x.id === categoryId);
  return c?.name ?? 'Uncategorized';
}

type ParsedItem = { name: string; quantity: number; category?: string; notes?: string };

function getParsedOrderItems(
  order: any,
  menuItems: MenuItemRow[],
  mealItems: MealItemRow[]
): ParsedItem[] {
  if (order.service_type === 'Food' || order.service_type === 'Meal' || order.service_type === 'Custom') {
    const items = order.items || [];
    if (items.length === 0) return [];
    return items.map((item: any) => {
      let menuItem = menuItems.find((mi) => mi.id === item.menu_item_id);
      if (!menuItem) menuItem = mealItems.find((mi) => mi.id === item.menu_item_id) as any;
      let itemName = 'Unknown Item';
      if (item.custom_name) itemName = `Custom Item (${item.custom_name})`;
      else if (menuItem?.name || item.menuItemName) itemName = menuItem?.name || item.menuItemName;
      else if (order.service_type === 'Custom' && item.notes) itemName = `Custom Item (${item.notes})`;
      const quantity = parseInt(String(item.quantity || 0), 10);
      return {
        name: itemName,
        quantity,
        category: menuItem?.category_id,
        notes: item.notes,
      };
    });
  }
  if (order.service_type === 'Boxes') {
    const boxes =
      order.boxSelections?.length > 0
        ? order.boxSelections
        : order.boxSelection
          ? [order.boxSelection]
          : [];
    if (boxes.length === 0) return [];
    const result: ParsedItem[] = [];
    for (const box of boxes) {
      const items = box.items || {};
      for (const [itemId, qtyOrObj] of Object.entries(items)) {
        const menuItem = menuItems.find((mi) => mi.id === itemId);
        let qty = 0;
        if (typeof qtyOrObj === 'number') qty = qtyOrObj;
        else if (qtyOrObj && typeof qtyOrObj === 'object' && 'quantity' in (qtyOrObj as object))
          qty = Number((qtyOrObj as { quantity: number }).quantity) || 0;
        else qty = parseInt(String(qtyOrObj), 10) || 0;
        if (qty > 0) {
          const notes = box.item_notes?.[itemId] ?? box.itemNotes?.[itemId];
          result.push({
            name: menuItem?.name ?? 'Unknown Item',
            quantity: qty,
            category: menuItem?.category_id,
            notes,
          });
        }
      }
    }
    return result;
  }
  if (order.service_type === 'Equipment') {
    const eq = order.equipmentSelection;
    if (!eq && order.notes) {
      try {
        const p = JSON.parse(order.notes);
        if (p?.equipmentName)
          return [{ name: p.equipmentName || 'Unknown Equipment', quantity: 1 }];
      } catch {}
    }
    if (eq)
      return [{ name: eq.equipmentName || 'Unknown Equipment', quantity: 1 }];
    return [{ name: 'No equipment details', quantity: 1 }];
  }
  return [];
}

function formatOrderedItemsForCSV(
  order: any,
  menuItems: MenuItemRow[],
  mealItems: MealItemRow[],
  categories: CategoryRow[]
): string {
  const parsed = getParsedOrderItems(order, menuItems, mealItems);
  if (parsed.length === 0) {
    if (order.service_type === 'Boxes') {
      const boxes = order.boxSelections ?? (order.boxSelection ? [order.boxSelection] : []);
      if (boxes.length === 0 || boxes.every((b: any) => !b || Object.keys(b.items || {}).length === 0))
        return 'MISSING SELECTION DATA';
      return '(No items)';
    }
    return 'No items';
  }
  if (order.service_type === 'Boxes') {
    const byCat: Record<string, string[]> = {};
    const uncat: string[] = [];
    parsed.forEach((item) => {
      const s = `${item.name} (Qty: ${item.quantity})`;
      if (item.category) {
        if (!byCat[item.category]) byCat[item.category] = [];
        byCat[item.category].push(s);
      } else uncat.push(s);
    });
    const parts: string[] = [];
    const sortedIds = Object.keys(byCat).sort((a, b) => {
      const na = categories.find((c) => c.id === a)?.name ?? '';
      const nb = categories.find((c) => c.id === b)?.name ?? '';
      return na.localeCompare(nb);
    });
    for (const cid of sortedIds) {
      const catName = categories.find((c) => c.id === cid)?.name ?? 'Unknown';
      parts.push(`${catName}: ${byCat[cid].join('; ')}`);
    }
    if (uncat.length) parts.push(`Uncategorized: ${uncat.join('; ')}`);
    return parts.join('; ');
  }
  return parsed
    .map((item) => {
      let s = `${item.name} (Qty: ${item.quantity})`;
      if (item.notes) s += ` (Note: ${item.notes})`;
      return s;
    })
    .join('; ');
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  try {
    return new Date(dateString + 'Z').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return String(dateString);
  }
}

function buildExcelAndWrite(
  orders: any[],
  dateKey: string,
  vendorName: string,
  clientMap: Map<string, ClientRow>,
  menuItems: MenuItemRow[],
  mealItems: MealItemRow[],
  categories: CategoryRow[],
  outputPath: string
) {
  const getClientNameFn = (clientId: string) => getClientName(clientMap, clientId);
  const getClientAddressFn = (clientId: string) => getClientAddress(clientMap, clientId);
  const getClientPhoneFn = (clientId: string) => getClientPhone(clientMap, clientId);
  const formatOrderedItems = (order: any) =>
    formatOrderedItemsForCSV(order, menuItems, mealItems, categories);

  const headers = [
    'Order Number',
    'Order ID',
    'Client ID',
    'Client Name',
    'Address',
    'Phone',
    'Scheduled Delivery Date',
    'Total Items',
    'Ordered Items',
    'Delivery Proof URL',
  ];
  const summaryData = orders.map((order) => [
    order.orderNumber || '',
    order.id || '',
    order.client_id || '',
    getClientNameFn(order.client_id),
    getClientAddressFn(order.client_id),
    getClientPhoneFn(order.client_id),
    order.scheduled_delivery_date || '',
    order.total_items ?? 0,
    formatOrderedItems(order),
    order.delivery_proof_url || '',
  ]);
  const wsSummary = XLSX.utils.aoa_to_sheet([headers, ...summaryData]);

  const detailsData: any[][] = [];
  orders.forEach((order) => {
    const items = getParsedOrderItems(order, menuItems, mealItems);
    detailsData.push([`Client: ${getClientNameFn(order.client_id)}`, `Order ID: ${order.orderNumber || order.id}`, '', '']);
    detailsData.push([`Address: ${getClientAddressFn(order.client_id)}`, '', '', '']);
    detailsData.push(['Item Name', 'Quantity', 'Category', 'Notes']);
    if (items.length > 0) {
      items.forEach((item) => {
        const cat = item.category ? getCategoryName(categories, item.category) : '';
        const catClean = cat === 'Uncategorized' ? '' : cat;
        detailsData.push([item.name, item.quantity, catClean, item.notes || '']);
      });
    } else {
      detailsData.push(['No items found', '', '', '']);
    }
    detailsData.push([]);
  });
  const wsDetails = XLSX.utils.aoa_to_sheet(detailsData);
  wsDetails['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 20 }, { wch: 40 }];

  const aggregation: Record<string, { name: string; quantity: number; notes: string }> = {};
  orders.forEach((order) => {
    const items = getParsedOrderItems(order, menuItems, mealItems);
    items.forEach((item) => {
      const noteKey = item.notes ? item.notes.trim().toLowerCase() : '';
      const key = `${item.name}||${noteKey}`;
      if (!aggregation[key]) aggregation[key] = { name: item.name, quantity: 0, notes: item.notes || '' };
      aggregation[key].quantity += item.quantity;
    });
  });
  const cookingListData = Object.values(aggregation)
    .sort((a, b) => {
      const n = a.name.localeCompare(b.name);
      if (n !== 0) return n;
      return (a.notes || '').localeCompare(b.notes || '');
    })
    .map((item) => [item.name, item.quantity, item.notes]);
  const wsCookingList = XLSX.utils.aoa_to_sheet([
    ['Item Name', 'Total Quantity', 'Notes'],
    ...cookingListData,
  ]);
  wsCookingList['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 40 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Orders Summary');
  XLSX.utils.book_append_sheet(wb, wsDetails, 'Client Breakdown');
  XLSX.utils.book_append_sheet(wb, wsCookingList, 'Cooking List');
  XLSX.writeFile(wb, outputPath);
}

async function main() {
  const { getOrdersByVendorForDateWithClient } = await import('../lib/actions');

  const dates = datesInRange();
  const outputRoot = path.resolve(process.cwd(), outputDirArg);
  console.log(`Output directory: ${outputRoot}`);
  console.log(`Date range: ${weekStartStr} to ${weekEndStr} (${dates.length} days)`);

  const ref = await loadReferenceData();
  const { vendors, clientMap, menuItems, mealItems, categories } = ref;
  console.log(`Loaded ${vendors.length} vendors, ${clientMap.size} clients`);

  const getClientNameFn = (clientId: string) => getClientName(clientMap, clientId);
  const getClientAddressFn = (clientId: string) => getClientAddress(clientMap, clientId);
  const formatOrderedItems = (order: any) =>
    formatOrderedItemsForCSV(order, menuItems, mealItems, categories);

  let totalExcel = 0;
  let totalLabels = 0;
  let skipped = 0;

  for (const dateKey of dates) {
    const dateDir = path.join(outputRoot, dateKey);
    if (!fs.existsSync(dateDir)) fs.mkdirSync(dateDir, { recursive: true });

    for (const vendor of vendors) {
      const orders = await getOrdersByVendorForDateWithClient(supabase, vendor.id, dateKey);
      const folderName = vendorFolderName(vendor);
      const vendorDir = path.join(dateDir, folderName);

      if (orders.length === 0) {
        skipped++;
        continue;
      }

      if (!fs.existsSync(vendorDir)) fs.mkdirSync(vendorDir, { recursive: true });

      const excelPath = path.join(vendorDir, 'orders.xlsx');
      const labelsPath = path.join(vendorDir, 'labels.pdf');

      buildExcelAndWrite(
        orders,
        dateKey,
        vendor.name,
        clientMap,
        menuItems,
        mealItems,
        categories,
        excelPath
      );
      totalExcel++;

      await generateLabelsPDF(
        {
          orders,
          getClientName: getClientNameFn,
          getClientAddress: getClientAddressFn,
          formatOrderedItemsForCSV: formatOrderedItems,
          formatDate,
          vendorName: vendor.name,
          deliveryDate: dateKey,
        },
        labelsPath
      );
      totalLabels++;

      console.log(`  ${dateKey} / ${folderName}: ${orders.length} orders -> Excel + PDF`);
    }
  }

  console.log('\nDone.');
  console.log(`  Excel files: ${totalExcel}`);
  console.log(`  Label PDFs: ${totalLabels}`);
  console.log(`  Vendor-days skipped (no orders): ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
