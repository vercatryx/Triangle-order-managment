-- Add screening_status column to clients table
-- This replaces the manual checkbox approach with an automatic status field

ALTER TABLE clients ADD COLUMN IF NOT EXISTS screening_status text DEFAULT 'not_started' 
    CHECK (screening_status IN ('not_started', 'waiting_approval', 'approved', 'rejected'));

-- Update existing clients to have a default status
UPDATE clients SET screening_status = 'not_started' WHERE screening_status IS NULL;
