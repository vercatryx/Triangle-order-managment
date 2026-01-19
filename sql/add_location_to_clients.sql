-- Add location_id to clients table
ALTER TABLE clients
ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

-- Index for performance
CREATE INDEX idx_clients_location_id ON clients(location_id);
