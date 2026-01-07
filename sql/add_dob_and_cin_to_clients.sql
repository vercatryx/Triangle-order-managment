-- Add dob and cin columns to clients table for dependents
-- dob: Date of birth for the dependent (DATE type)
-- cin: CIN number for the dependent (can contain letters and numbers)

ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS dob DATE,
ADD COLUMN IF NOT EXISTS cin VARCHAR(50);

-- Add comments for documentation
COMMENT ON COLUMN clients.dob IS 'Date of birth for the dependent (DATE type).';
COMMENT ON COLUMN clients.cin IS 'CIN number for the dependent (can contain letters and numbers).';



