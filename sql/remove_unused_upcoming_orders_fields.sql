-- ============================================================================
-- REMOVE UNUSED FIELDS FROM upcoming_orders TABLE
-- ============================================================================
-- This migration removes fields that are not needed for upcoming_orders:
-- 
-- 1. delivery_proof_url - Only used in orders table, not upcoming_orders
-- 2. scheduled_delivery_date - Can be calculated from delivery_day when needed
-- 3. take_effect_date - KEEP THIS (used in processUpcomingOrders to determine when to process)
-- 4. delivery_distribution - Can be calculated/stored in orders table when processed
-- 
-- Note: take_effect_date is REQUIRED and should NOT be removed as it's used
-- in processUpcomingOrders() to determine which upcoming orders to process.
-- ============================================================================

BEGIN;

-- Step 1: Remove delivery_proof_url (only used in orders, not upcoming_orders)
ALTER TABLE upcoming_orders
    DROP COLUMN IF EXISTS delivery_proof_url;

-- Step 2: Remove scheduled_delivery_date (can be calculated from delivery_day)
-- Note: This is copied to orders table when processing, but can be calculated
-- from delivery_day + current date when needed
ALTER TABLE upcoming_orders
    DROP COLUMN IF EXISTS scheduled_delivery_date;

-- Step 3: Remove delivery_distribution (can be stored in orders when processed)
-- Note: This is copied to orders table when processing, but can be stored
-- in the order config or calculated when the order is created
ALTER TABLE upcoming_orders
    DROP COLUMN IF EXISTS delivery_distribution;

-- Step 4: Add comment to document the simplified structure
COMMENT ON TABLE upcoming_orders IS 
    'Upcoming orders scheduled for future delivery. take_effect_date determines when to process. delivery_day specifies the day of week.';

COMMENT ON COLUMN upcoming_orders.take_effect_date IS 
    'Date when this upcoming order should be processed and moved to orders table. Required for processUpcomingOrders().';

COMMENT ON COLUMN upcoming_orders.delivery_day IS 
    'Day of week for delivery (e.g., "Monday", "Wednesday"). Used to calculate scheduled_delivery_date when processing.';

COMMIT;


