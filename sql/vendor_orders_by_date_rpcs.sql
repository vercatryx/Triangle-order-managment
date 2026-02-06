-- Vendor orders filtered at DB level (for 100k+ orders).
-- Run in Supabase SQL Editor. Required for vendor detail and vendor delivery pages to load.

-- 1. Summary of delivery dates with counts (for vendor detail page list)
CREATE OR REPLACE FUNCTION get_vendor_delivery_date_summary(p_vendor_id uuid)
RETURNS TABLE (
  scheduled_delivery_date date,
  order_count bigint,
  total_items numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.scheduled_delivery_date,
    COUNT(*)::bigint AS order_count,
    COALESCE(SUM(o.total_items), 0)::numeric AS total_items
  FROM orders o
  WHERE (
    EXISTS (SELECT 1 FROM order_vendor_selections ovs WHERE ovs.order_id = o.id AND ovs.vendor_id = p_vendor_id)
    OR EXISTS (SELECT 1 FROM order_box_selections obs WHERE obs.order_id = o.id AND obs.vendor_id = p_vendor_id)
    OR (o.service_type = 'Equipment' AND o.notes IS NOT NULL AND (o.notes::jsonb->>'vendorId') = p_vendor_id::text)
  )
  GROUP BY o.scheduled_delivery_date
  ORDER BY o.scheduled_delivery_date DESC NULLS LAST;
END;
$$;

-- 2. Orders for a single delivery date (for vendor delivery page and exports)
CREATE OR REPLACE FUNCTION get_orders_by_vendor_and_date(p_vendor_id uuid, p_delivery_date date)
RETURNS SETOF orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.*
  FROM orders o
  WHERE (
    (p_delivery_date IS NOT NULL AND o.scheduled_delivery_date = p_delivery_date)
    OR (p_delivery_date IS NULL AND o.scheduled_delivery_date IS NULL)
  )
  AND (
    EXISTS (SELECT 1 FROM order_vendor_selections ovs WHERE ovs.order_id = o.id AND ovs.vendor_id = p_vendor_id)
    OR EXISTS (SELECT 1 FROM order_box_selections obs WHERE obs.order_id = o.id AND obs.vendor_id = p_vendor_id)
    OR (o.service_type = 'Equipment' AND o.notes IS NOT NULL AND (o.notes::jsonb->>'vendorId') = p_vendor_id::text)
  )
  ORDER BY o.created_at DESC;
END;
$$;
