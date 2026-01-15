
-- Enable RLS just in case it isn't enabled (default is usually enabled for new tables)
ALTER TABLE order_vendor_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to avoid errors
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON order_vendor_selections;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON order_items;

-- Create policy for order_vendor_selections
CREATE POLICY "Enable read access for authenticated users"
ON order_vendor_selections
FOR SELECT
TO authenticated
USING (true);

-- Create policy for order_items (just in case)
CREATE POLICY "Enable read access for authenticated users"
ON order_items
FOR SELECT
TO authenticated
USING (true);

-- Also allow insert/update for authenticated users (or restrict based on role if needed, but for now open it up to unblock)
-- Assuming backend logic handles validation.
-- Though traditionally we might want to restrict to owner, but order creation is automated or admin. 
-- Let's just enable SELECT for now as that's the visibility bug. 
-- Admin uses service_role which bypasses RLS anyway.
