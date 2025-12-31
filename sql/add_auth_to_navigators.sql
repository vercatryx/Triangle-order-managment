-- Add email and password columns to navigators table
ALTER TABLE navigators 
ADD COLUMN email TEXT UNIQUE,
ADD COLUMN password TEXT;

-- Create index for faster lookups by email
CREATE INDEX idx_navigators_email ON navigators(email);
