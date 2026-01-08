-- Drop the foreign key constraints on updated_by to allow saves without valid user references
-- This is needed because the session userId doesn't always match a valid user in the database

ALTER TABLE client_food_orders DROP CONSTRAINT IF EXISTS client_food_orders_updated_by_fkey;
ALTER TABLE client_meal_orders DROP CONSTRAINT IF EXISTS client_meal_orders_updated_by_fkey;
ALTER TABLE client_box_orders DROP CONSTRAINT IF EXISTS client_box_orders_updated_by_fkey;

-- Also make the columns nullable
ALTER TABLE client_food_orders ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE client_meal_orders ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE client_box_orders ALTER COLUMN updated_by DROP NOT NULL;
