-- Create a table for Global Locations
CREATE TABLE IF NOT EXISTS locations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Re-create vendor_locations as a join/link table
-- We drop the old one to avoid schema conflicts/confusion since the paradigm changed
DROP TABLE IF EXISTS vendor_locations;

CREATE TABLE vendor_locations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE NOT NULL,
    location_id UUID REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(vendor_id, location_id) -- Prevent duplicate links
);

-- Enable RLS (Row Level Security) - Optional best practice, assuming public/authenticated access for now or existing policies
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_locations ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all access for now (or match existing patterns)
CREATE POLICY "Enable all access for authenticated users" ON locations FOR ALL USING (true);
CREATE POLICY "Enable all access for authenticated users" ON vendor_locations FOR ALL USING (true);
