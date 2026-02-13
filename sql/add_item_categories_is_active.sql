-- Add is_active column to item_categories for deactivating box categories
-- Inactive categories do not show in order building (only in admin Box Categories settings)
-- Existing rows get is_active = true. Run this migration before deploying the feature.
ALTER TABLE item_categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true NOT NULL;
