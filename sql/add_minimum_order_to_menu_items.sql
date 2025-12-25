-- Add minimum_order column to menu_items table
-- This column stores the minimum order quantity required for each menu item/product
-- Default value is 0, which means no minimum order requirement
-- Used in: MenuManagement (admin UI) and ClientProfile (order form validation)

ALTER TABLE menu_items 
ADD COLUMN IF NOT EXISTS minimum_order INTEGER NOT NULL DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN menu_items.minimum_order IS 'Minimum order quantity required for this product. Default is 0 (no minimum requirement).';
