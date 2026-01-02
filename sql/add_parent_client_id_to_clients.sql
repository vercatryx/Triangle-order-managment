-- Add parent_client_id column to clients table to support dependents
-- This allows clients to have dependents attached to them
ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS parent_client_id TEXT REFERENCES clients(id) ON DELETE SET NULL;

-- Add comment for documentation
COMMENT ON COLUMN clients.parent_client_id IS 'If set, this client is a dependent of another client. NULL for regular clients.';

