-- Create admins table
CREATE TABLE IF NOT EXISTS admins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Optional: Insert a default admin if you want (password needs to be hashed first though)
-- INSERT INTO admins (username, password) VALUES ('admin', '$2a$10$HASHED_PASSWORD_HERE');
