-- Add minimum_meals column to vendors table
-- This column stores the minimum number of meals required when ordering from a Food vendor
-- Default value is 0, which means no minimum requirement
-- Only applies to vendors with service_type = 'Food'
-- Used in: VendorManagement (admin UI) and ClientProfile (order validation)

ALTER TABLE vendors 
ADD COLUMN IF NOT EXISTS minimum_meals INTEGER NOT NULL DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN vendors.minimum_meals IS 'Minimum number of meals required when ordering from this vendor. Only applies to Food vendors. Default is 0 (no minimum requirement).';



