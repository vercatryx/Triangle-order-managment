-- Fix the status check constraint on orders table to include all valid OrderStatus values
-- The current constraint only allows 'scheduled', 'processed', 'delivered'
-- But the code uses: 'pending', 'confirmed', 'completed', 'waiting_for_proof', 'billing_pending', 'cancelled'

-- Drop existing constraint
ALTER TABLE orders 
DROP CONSTRAINT IF EXISTS orders_status_check;

-- Add new constraint with all valid statuses
ALTER TABLE orders 
ADD CONSTRAINT orders_status_check 
CHECK (status IN (
    'pending', 
    'confirmed', 
    'completed', 
    'waiting_for_proof', 
    'billing_pending', 
    'cancelled',
    'scheduled', 
    'processed', 
    'delivered'
));

-- Also update upcoming_orders if it has the same issue
ALTER TABLE upcoming_orders 
DROP CONSTRAINT IF EXISTS upcoming_orders_status_check;

ALTER TABLE upcoming_orders 
ADD CONSTRAINT upcoming_orders_status_check 
CHECK (status IN (
    'pending', 
    'confirmed', 
    'completed', 
    'waiting_for_proof', 
    'billing_pending', 
    'cancelled',
    'scheduled', 
    'processed', 
    'delivered'
));

-- Add comments for documentation
COMMENT ON CONSTRAINT orders_status_check ON orders IS 
'Ensures status is one of the valid OrderStatus values: pending, confirmed, completed, waiting_for_proof, billing_pending, cancelled, scheduled, processed, delivered';

COMMENT ON CONSTRAINT upcoming_orders_status_check ON upcoming_orders IS 
'Ensures status is one of the valid OrderStatus values: pending, confirmed, completed, waiting_for_proof, billing_pending, cancelled, scheduled, processed, delivered';

