/**
 * For each inactive box category (item_categories.is_active = false),
 * set is_active = false on every menu_item that belongs to it and is still active.
 * Only touches "box items" (vendor_id IS NULL or '').
 *
 * Run:
 *   npx tsx scripts/deactivate-items-in-inactive-categories.ts --dry-run
 *   npx tsx scripts/deactivate-items-in-inactive-categories.ts
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY in .env.local
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

const DRY_RUN = process.argv.includes('--dry-run');

type CategoryRow = { id: string; name: string; is_active: boolean };
type MenuItemRow = { id: string; name: string; is_active: boolean; category_id: string | null; vendor_id: string | null };

async function main() {
  console.log(`Deactivate items inside inactive box categories. ${DRY_RUN ? '(DRY RUN)' : 'APPLYING CHANGES'}\n`);

  const { data: categories, error: catErr } = await supabase
    .from('item_categories')
    .select('id, name, is_active');

  if (catErr) {
    console.error('Error fetching item_categories:', catErr);
    process.exit(1);
  }

  const allCategories = (categories || []) as CategoryRow[];
  const inactiveCategories = allCategories.filter(c => c.is_active === false);

  console.log(`Total box categories: ${allCategories.length}`);
  console.log(`Inactive categories:  ${inactiveCategories.length}`);

  if (inactiveCategories.length === 0) {
    console.log('\nNo inactive categories found. Nothing to do.');
    return;
  }

  const inactiveCatIds = inactiveCategories.map(c => c.id);

  const { data: items, error: itemErr } = await supabase
    .from('menu_items')
    .select('id, name, is_active, category_id, vendor_id')
    .in('category_id', inactiveCatIds);

  if (itemErr) {
    console.error('Error fetching menu_items:', itemErr);
    process.exit(1);
  }

  const allItemsInInactive = (items || []) as MenuItemRow[];
  const boxItems = allItemsInInactive.filter(i => i.vendor_id == null || i.vendor_id === '');
  const toDeactivate = boxItems.filter(i => i.is_active === true);

  console.log(`\nItems in inactive categories: ${allItemsInInactive.length} (${boxItems.length} box items)`);
  console.log(`Already inactive:             ${boxItems.length - toDeactivate.length}`);
  console.log(`Items to deactivate:          ${toDeactivate.length}\n`);

  if (toDeactivate.length === 0) {
    console.log('All items in inactive categories are already deactivated. Nothing to do.');
    return;
  }

  const catNameMap = new Map(inactiveCategories.map(c => [c.id, c.name]));

  for (const item of toDeactivate) {
    const catName = catNameMap.get(item.category_id!) || '(unknown)';
    console.log(`  [${catName}] "${item.name}" (${item.id}) — will be deactivated`);
  }

  if (!DRY_RUN) {
    const idsToUpdate = toDeactivate.map(i => i.id);
    const BATCH = 200;
    for (let i = 0; i < idsToUpdate.length; i += BATCH) {
      const chunk = idsToUpdate.slice(i, i + BATCH);
      const { error } = await supabase
        .from('menu_items')
        .update({ is_active: false })
        .in('id', chunk);
      if (error) {
        console.error('Error updating menu_items:', error);
        process.exit(1);
      }
    }
    console.log(`\nDone. Deactivated ${toDeactivate.length} items.`);
  } else {
    console.log(`\nDry run complete. Run without --dry-run to apply changes.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
