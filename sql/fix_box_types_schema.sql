-- 1. Create the missing box_types table
CREATE TABLE IF NOT EXISTS box_types (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  name TEXT NOT NULL,
  vendor_id UUID REFERENCES vendors(id),
  is_active BOOLEAN DEFAULT true,
  price_each DECIMAL(10, 2) DEFAULT 0
);

-- 2. Add the column to order_box_selections referencing the valid table
ALTER TABLE order_box_selections 
ADD COLUMN IF NOT EXISTS box_type_id UUID REFERENCES box_types(id);

-- 3. (Optional) Also ensure client_box_orders has the reference if needed (based on inferred_client_box_orders.sql)
-- ALTER TABLE client_box_orders 
-- ADD COLUMN IF NOT EXISTS box_type_id UUID REFERENCES box_types(id);
