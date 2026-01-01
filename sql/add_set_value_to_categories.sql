-- Add set_value column to item_categories table
-- This column stores the required quota value for the category
-- When set, users must select items that sum to exactly this quota value
-- NULL means no requirement (flexible selection)
-- Used in: BoxCategoriesManagement (admin UI) and ClientProfile (enforcement)

ALTER TABLE item_categories 
ADD COLUMN IF NOT EXISTS set_value INTEGER;

-- Add comment for documentation
COMMENT ON COLUMN item_categories.set_value IS 'Required quota value for this category. When set, users must select items that sum to exactly this value. NULL means no requirement.';

