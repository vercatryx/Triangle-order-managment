-- Create breakfast_categories table
CREATE TABLE IF NOT EXISTS breakfast_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    set_value INTEGER, -- Optional quota requirement
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create breakfast_items table
CREATE TABLE IF NOT EXISTS breakfast_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES breakfast_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quota_value INTEGER DEFAULT 1,
    price_each NUMERIC,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add indexes
CREATE INDEX IF NOT EXISTS breakfast_items_category_id_idx ON breakfast_items(category_id);
