-- Fix for missing box_type_id column in upcoming_order_box_selections table
-- This causes errors when saving box orders with specific box types

DO $$ 
BEGIN 
    -- Add box_type_id to upcoming_order_box_selections if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'upcoming_order_box_selections' 
        AND column_name = 'box_type_id'
    ) THEN 
        ALTER TABLE upcoming_order_box_selections 
        ADD COLUMN box_type_id UUID REFERENCES box_types(id);
    END IF;

    -- Add index for performance on the foreign key
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE tablename = 'upcoming_order_box_selections'
        AND indexname = 'idx_upcoming_order_box_selections_box_type_id'
    ) THEN
        CREATE INDEX idx_upcoming_order_box_selections_box_type_id 
        ON upcoming_order_box_selections(box_type_id);
    END IF;
END $$;
