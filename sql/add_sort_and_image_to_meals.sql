ALTER TABLE breakfast_categories ADD COLUMN sort_order INTEGER DEFAULT 0;
ALTER TABLE breakfast_items ADD COLUMN sort_order INTEGER DEFAULT 0;
ALTER TABLE breakfast_items ADD COLUMN image_url TEXT;
