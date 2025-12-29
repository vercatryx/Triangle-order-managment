-- Update unique constraint on upcoming_orders to allow multiple orders per client
-- The constraint should be unique on (client_id, delivery_day) instead of just client_id
-- This allows clients to have multiple orders when vendors have multiple delivery days

-- First, drop the old constraint/index if it exists
ALTER TABLE upcoming_orders 
DROP CONSTRAINT IF EXISTS unique_upcoming_order_per_client;

DROP INDEX IF EXISTS unique_upcoming_order_per_client_per_day;

-- Create a new unique constraint on (client_id, delivery_day)
-- This allows multiple orders per client, but only one per client per delivery day
-- PostgreSQL treats NULL as distinct, so:
-- - A client can have one order with NULL delivery_day (for backward compatibility)
-- - A client can have multiple orders with different delivery_day values
-- - A client cannot have duplicate orders with the same delivery_day (including NULL)
CREATE UNIQUE INDEX unique_upcoming_order_per_client_per_day 
ON upcoming_orders (client_id, delivery_day);

-- Add comment for documentation
COMMENT ON INDEX unique_upcoming_order_per_client_per_day IS 'Ensures one upcoming order per client per delivery day. Allows multiple orders per client when delivery_day differs. NULL delivery_day is treated as a distinct value, so a client can have one order with NULL and multiple orders with specific delivery days.';

