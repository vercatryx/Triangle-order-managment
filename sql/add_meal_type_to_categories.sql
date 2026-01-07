-- Add meal_type column to breakfast_categories
ALTER TABLE breakfast_categories 
ADD COLUMN meal_type TEXT NOT NULL DEFAULT 'Breakfast';

-- Create an index for performance
CREATE INDEX idx_breakfast_categories_meal_type ON breakfast_categories(meal_type);
