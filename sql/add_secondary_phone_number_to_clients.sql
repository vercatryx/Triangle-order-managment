-- Add secondary_phone_number column to clients table
-- This allows clients to have an optional secondary phone number
ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS secondary_phone_number TEXT;

-- Add comment for documentation
COMMENT ON COLUMN clients.secondary_phone_number IS 'Optional secondary phone number for the client. Can be empty.';

