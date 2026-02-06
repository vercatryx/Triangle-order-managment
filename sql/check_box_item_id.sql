-- Check if box item ID exists in menu_items or breakfast_items
-- Run in Supabase SQL Editor to find why an item shows as "Unknown"

-- Check menu_items (has vendor_id, category_id)
SELECT 'menu_items' AS source, id, name, vendor_id, category_id
FROM menu_items
WHERE id = 'c57518b5-e870-49b1-a3cf-f67eaece387b';

-- Check breakfast_items (no vendor_id)
SELECT 'breakfast_items' AS source, id, name, category_id
FROM breakfast_items
WHERE id = 'c57518b5-e870-49b1-a3cf-f67eaece387b';
