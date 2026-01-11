-- Add item_notes column to client_box_orders table to support per-item notes
ALTER TABLE client_box_orders 
ADD COLUMN IF NOT EXISTS item_notes JSONB;

-- Verify the column was added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'client_box_orders' 
AND column_name = 'item_notes';
