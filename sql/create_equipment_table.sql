-- Create equipment table
CREATE TABLE IF NOT EXISTS equipment (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add comment for documentation
COMMENT ON TABLE equipment IS 'Equipment items that can be added to orders or tracked separately';
COMMENT ON COLUMN equipment.name IS 'Name of the equipment item';
COMMENT ON COLUMN equipment.price IS 'Price of the equipment item';

