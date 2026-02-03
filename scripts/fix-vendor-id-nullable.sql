-- SQL to ensure vendor_id can be NULL in upcoming_order_vendor_selections
-- Run this on your Supabase dashboard under SQL Editor

-- Check current constraint
SELECT 
    column_name, 
    is_nullable, 
    data_type 
FROM information_schema.columns 
WHERE table_name = 'upcoming_order_vendor_selections' 
AND column_name = 'vendor_id';

-- If vendor_id is NOT NULL, run this to allow NULL values:
ALTER TABLE upcoming_order_vendor_selections 
ALTER COLUMN vendor_id DROP NOT NULL;

-- Verify the change
SELECT 
    column_name, 
    is_nullable, 
    data_type 
FROM information_schema.columns 
WHERE table_name = 'upcoming_order_vendor_selections' 
AND column_name = 'vendor_id';
