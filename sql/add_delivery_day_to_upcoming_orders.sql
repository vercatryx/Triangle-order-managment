-- Add delivery_day column to upcoming_orders table
-- This column stores the day of week (e.g., "Monday", "Thursday") for which this order is scheduled
-- Allows clients to have multiple orders for vendors with multiple delivery days
-- Each order works independently for its specific delivery day

ALTER TABLE upcoming_orders 
ADD COLUMN IF NOT EXISTS delivery_day TEXT;

-- Add comment for documentation
COMMENT ON COLUMN upcoming_orders.delivery_day IS 'Day of week (e.g., "Monday", "Thursday") for which this order is scheduled. Allows multiple orders per client when vendors have multiple delivery days.';

