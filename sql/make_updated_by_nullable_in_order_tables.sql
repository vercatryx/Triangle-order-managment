-- Make updated_by nullable in new order tables
-- This allows orders to be saved even when the session user ID doesn't match a valid foreign key reference

ALTER TABLE client_food_orders ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE client_meal_orders ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE client_box_orders ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN updated_by DROP NOT NULL;
