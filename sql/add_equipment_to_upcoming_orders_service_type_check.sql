-- Add 'Equipment' to the service_type check constraint on upcoming_orders table
-- This allows Equipment orders to be created in the upcoming_orders table (if needed in the future)

-- First, drop the existing constraint if it exists
ALTER TABLE upcoming_orders 
DROP CONSTRAINT IF EXISTS upcoming_orders_service_type_check;

-- Recreate the constraint with Equipment included
ALTER TABLE upcoming_orders 
ADD CONSTRAINT upcoming_orders_service_type_check 
CHECK (service_type IN ('Food', 'Boxes', 'Equipment'));

-- Add comment for documentation
COMMENT ON CONSTRAINT upcoming_orders_service_type_check ON upcoming_orders IS 
'Ensures service_type is one of: Food, Boxes, or Equipment';

