-- Add comments column to form_submissions table
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS comments text;
