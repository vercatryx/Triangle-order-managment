-- Add meal_type column
ALTER TABLE upcoming_orders 
ADD COLUMN IF NOT EXISTS meal_type TEXT DEFAULT 'Lunch';

-- Update existing records to have a default meal_type if it was null (though we set default above)
UPDATE upcoming_orders SET meal_type = 'Lunch' WHERE meal_type IS NULL;

-- Drop old unique constraint
ALTER TABLE upcoming_orders 
DROP CONSTRAINT IF EXISTS unique_upcoming_order_per_client_per_day;

-- Add new unique constraint including meal_type
-- Using COALESCE to handle potential NULLs in delivery_day if existing logic allowed it (though our target is per day)
-- But standard unique index with NULLs treats them as distinct. 
-- However, for our logic, we want (client_id, delivery_day, meal_type) to be unique.
-- delivery_day can be null in some old logic (Boxes), but we should probably include meal_type there too to be safe.
-- For now, let's focus on the food orders which have delivery_day.

CREATE UNIQUE INDEX IF NOT EXISTS unique_upcoming_order_per_client_day_meal 
ON upcoming_orders (client_id, delivery_day, meal_type)
WHERE delivery_day IS NOT NULL;

-- If delivery_day IS NULL (legacy or boxes), we might want another constraint or just leave it.
-- Let's stick to the main requirement.
