-- Run this in Supabase SQL Editor to see why "invalid input syntax for type uuid: CLIENT-1063" happens.
-- client_box_orders.client_id should be 'text' or 'character varying' for the app to work.

SELECT
  'client_box_orders.client_id' AS column_ref,
  c.data_type,
  c.udt_name
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'client_box_orders'
  AND c.column_name = 'client_id'
UNION ALL
SELECT
  'clients.id',
  c.data_type,
  c.udt_name
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'clients'
  AND c.column_name = 'id';
