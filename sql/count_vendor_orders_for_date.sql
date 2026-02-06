-- =============================================================================
-- DEFINITIVE COUNT: orders for a vendor on a single delivery date (no app limits).
-- Run in Supabase SQL Editor. Edit vendor_id and delivery_date in params below.
-- =============================================================================

WITH params AS (
  SELECT
    -- EDIT: vendor UUID (must match exactly)
    '3759e864-908e-427e-9e2b-6e139643bdcc'::uuid AS vendor_id,
    -- EDIT: delivery date – only this calendar day is included
    '2026-02-10'::date AS delivery_date
),
-- Only orders whose scheduled_delivery_date is exactly that day (single-day window)
eligible_orders AS (
  SELECT o.id AS order_id
  FROM orders o
  CROSS JOIN params p
  WHERE o.scheduled_delivery_date >= p.delivery_date
    AND o.scheduled_delivery_date <  p.delivery_date + 1
    AND (
      EXISTS (SELECT 1 FROM order_vendor_selections ovs WHERE ovs.order_id = o.id AND ovs.vendor_id = p.vendor_id)
      OR EXISTS (SELECT 1 FROM order_box_selections obs WHERE obs.order_id = o.id AND obs.vendor_id = p.vendor_id)
      OR (o.service_type = 'Equipment' AND o.notes IS NOT NULL AND (o.notes::jsonb->>'vendorId') = p.vendor_id::text)
    )
)
-- Single row: summary + count + all order ids (definitive total)
SELECT
  (SELECT vendor_id FROM params) AS vendor_id,
  (SELECT delivery_date FROM params) AS delivery_date,
  (SELECT name FROM vendors WHERE id = (SELECT vendor_id FROM params)) AS vendor_name,
  (SELECT COUNT(*)::int FROM eligible_orders) AS total_orders,
  (SELECT json_agg(order_id ORDER BY order_id) FROM eligible_orders) AS order_ids;

-- Optional: uncomment below to list every order_id one per row (scan every last order)
-- SELECT e.order_id FROM eligible_orders e ORDER BY e.order_id;
