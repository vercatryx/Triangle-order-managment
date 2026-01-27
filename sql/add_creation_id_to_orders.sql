-- Add creation_id column to orders table
-- This column stores a numeric ID that groups orders created in the same batch/round
-- Allows undoing entire rounds of order creation

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS creation_id INTEGER;

-- Create index for faster lookups by creation_id
CREATE INDEX IF NOT EXISTS idx_orders_creation_id ON orders(creation_id);

-- Add comment to document the column
COMMENT ON COLUMN orders.creation_id IS 'Numeric ID that groups orders created in the same batch/round. Used to undo entire rounds of order creation.';
