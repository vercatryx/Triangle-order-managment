-- Add the column to order_box_selections without foreign key reference to box_types
ALTER TABLE order_box_selections 
ADD COLUMN IF NOT EXISTS box_type_id UUID;

-- Optional: If you want to index it for performance
CREATE INDEX IF NOT EXISTS order_box_selections_box_type_id_idx ON order_box_selections(box_type_id);
