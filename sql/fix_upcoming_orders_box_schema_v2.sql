-- Comprehensive fix for Box Types schema
-- 1. Creates the box_types table if it doesn't exist
-- 2. Adds the missing column to upcoming_order_box_selections

BEGIN;

-- 1. Create box_types table
CREATE TABLE IF NOT EXISTS box_types (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    name TEXT NOT NULL,
    vendor_id UUID REFERENCES vendors(id),
    is_active BOOLEAN DEFAULT true,
    price_each DECIMAL(10, 2) DEFAULT 0
);

-- Enable RLS (Safety best practice)
ALTER TABLE box_types ENABLE ROW LEVEL SECURITY;

-- Create policy to allow read access to everyone
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'box_types' AND policyname = 'Allow public read access'
    ) THEN
        CREATE POLICY "Allow public read access" ON box_types 
        FOR SELECT USING (true);
    END IF;
END $$;

-- 2. Add box_type_id column to upcoming_order_box_selections
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'upcoming_order_box_selections' 
        AND column_name = 'box_type_id'
    ) THEN 
        ALTER TABLE upcoming_order_box_selections 
        ADD COLUMN box_type_id UUID REFERENCES box_types(id);
    END IF;
END $$;

-- 3. Add index for performance
DO $$
BEGIN
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

COMMIT;
