-- Create table for form submissions (drafts and completed)
create table if not exists form_submissions (
  id uuid default gen_random_uuid() primary key,
  form_id uuid references forms(id) on delete cascade not null,
  client_id text references clients(id) on delete set null, -- Changed to text to match clients table
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  data jsonb not null default '{}'::jsonb, -- Stores the answers
  signature_url text, -- URL to signature image
  pdf_url text, -- URL to final signed PDF
  token uuid default gen_random_uuid() unique not null, -- Secure token for public access
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Enable RLS
alter table form_submissions enable row level security;

-- Policies
-- 1. Authenticated users (admin/staff) can view and manage all submissions (simplified policy)
create policy "Authenticated users can manage submissions"
  on form_submissions
  for all
  to authenticated
  using (true)
  with check (true);

-- 2. Public access (via Server Actions with Service Role mostly, but if we wanted direct access):
-- We generally rely on Server Actions with Service Key for the public 'view via token' flow to avoid complex RLS with tokens.
-- So we won't add an anon policy here unless specifically needed for client-side fetching.

-- Trigger to update updated_at
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger update_form_submissions_updated_at
before update on form_submissions
for each row
execute function update_updated_at_column();
