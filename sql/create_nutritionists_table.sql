-- Create nutritionists table
CREATE TABLE IF NOT EXISTS nutritionists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add comment for documentation
COMMENT ON TABLE nutritionists IS 'Stores nutritionist information with name and email';


