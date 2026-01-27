-- Add order_history JSON column to clients table
-- This column will store a JSON array of all order details (upcoming orders and created orders)
-- Each entry includes vendor details, items, notes, and all other order information

ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS order_history JSONB DEFAULT '[]'::jsonb;

-- Add index for JSONB queries (optional, but can help with performance)
CREATE INDEX IF NOT EXISTS idx_clients_order_history ON clients USING GIN (order_history);
