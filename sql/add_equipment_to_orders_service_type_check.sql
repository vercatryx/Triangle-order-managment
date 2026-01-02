-- Add 'Equipment' to the service_type check constraint on orders table
-- This allows Equipment orders to be created in the orders table

-- First, drop the existing constraint if it exists
ALTER TABLE orders 
DROP CONSTRAINT IF EXISTS orders_service_type_check;

-- Recreate the constraint with Equipment included
ALTER TABLE orders 
ADD CONSTRAINT orders_service_type_check 
CHECK (service_type IN ('Food', 'Boxes', 'Equipment'));

-- Add comment for documentation
COMMENT ON CONSTRAINT orders_service_type_check ON orders IS 
'Ensures service_type is one of: Food, Boxes, or Equipment';

