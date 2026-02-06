-- Add item_notes column to order_box_selections for per-item notes (vendor export / order detail)
ALTER TABLE order_box_selections
ADD COLUMN IF NOT EXISTS item_notes JSONB DEFAULT '{}'::jsonb;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'order_box_selections'
AND column_name = 'item_notes';
