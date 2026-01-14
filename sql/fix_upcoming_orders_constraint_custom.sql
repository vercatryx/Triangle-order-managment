-- Fix for 'Custom' service type in upcoming_orders table
-- The previous constraint upcoming_orders_service_type_check did not include 'Custom'

-- 1. Drop the existing constraint
ALTER TABLE upcoming_orders DROP CONSTRAINT IF EXISTS upcoming_orders_service_type_check;

-- 2. Add the new constraint with 'Custom' included
ALTER TABLE upcoming_orders 
ADD CONSTRAINT upcoming_orders_service_type_check 
CHECK (service_type IN ('Food', 'Boxes', 'Equipment', 'Meal', 'Custom'));

-- Optional: Verify the change
-- SELECT constraint_name, check_clause FROM information_schema.check_constraints WHERE constraint_name = 'upcoming_orders_service_type_check';
