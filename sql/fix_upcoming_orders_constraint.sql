-- Fix unique constraint on upcoming_orders to allow multiple orders per client
-- This script will:
-- 1. Drop the old constraint if it exists
-- 2. Create a new unique index on (client_id, delivery_day)
-- 3. Verify the constraint is working

-- Step 1: Drop old constraint/index
DO $$ 
BEGIN
    -- Drop constraint if it exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_upcoming_order_per_client'
    ) THEN
        ALTER TABLE upcoming_orders 
        DROP CONSTRAINT unique_upcoming_order_per_client;
        RAISE NOTICE 'Dropped old constraint: unique_upcoming_order_per_client';
    END IF;
    
    -- Drop index if it exists
    IF EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'unique_upcoming_order_per_client_per_day'
    ) THEN
        DROP INDEX IF EXISTS unique_upcoming_order_per_client_per_day;
        RAISE NOTICE 'Dropped old index: unique_upcoming_order_per_client_per_day';
    END IF;
END $$;

-- Step 2: Create new unique index on (client_id, delivery_day)
-- This allows multiple orders per client (one per delivery day)
-- NULL delivery_day is treated as a distinct value
CREATE UNIQUE INDEX IF NOT EXISTS unique_upcoming_order_per_client_per_day 
ON upcoming_orders (client_id, delivery_day);

-- Step 3: Add comment
COMMENT ON INDEX unique_upcoming_order_per_client_per_day IS 
'Ensures one upcoming order per client per delivery day. Allows multiple orders per client when delivery_day differs. NULL delivery_day is treated as a distinct value.';

-- Step 4: Verify the constraint
DO $$
DECLARE
    constraint_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'unique_upcoming_order_per_client_per_day'
    ) INTO constraint_exists;
    
    IF constraint_exists THEN
        RAISE NOTICE 'SUCCESS: Unique constraint created successfully';
        RAISE NOTICE 'The database can now hold multiple orders per client (one per delivery_day)';
    ELSE
        RAISE EXCEPTION 'ERROR: Failed to create unique constraint';
    END IF;
END $$;



