-- Create forms table
create table if not exists forms (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create questions table
create table if not exists questions (
  id uuid default gen_random_uuid() primary key,
  form_id uuid references forms(id) on delete cascade not null,
  text text not null,
  type text not null check (type in ('text', 'select')),
  options jsonb, -- Stores array of strings for select options
  "order" integer not null default 0,
  created_at timestamptz default now()
);

-- Create filled_forms table (for submissions)
create table if not exists filled_forms (
  id uuid default gen_random_uuid() primary key,
  form_id uuid references forms(id) on delete cascade not null,
  submitted_at timestamptz default now()
);

-- Create answers table
create table if not exists form_answers (
  id uuid default gen_random_uuid() primary key,
  filled_form_id uuid references filled_forms(id) on delete cascade not null,
  question_id uuid references questions(id) on delete cascade not null,
  value text,
  created_at timestamptz default now()
);

-- Enable Row Level Security (RLS)
alter table forms enable row level security;
alter table questions enable row level security;
alter table filled_forms enable row level security;
alter table form_answers enable row level security;

-- Create policies (modify as needed for your auth setup)
-- For now, allow public access or authenticated access depending on requirements.
-- Assuming internal tool, we'll allow authenticated users full access.

create policy "Allow authenticated full access to forms"
  on forms for all
  to authenticated
  using (true)
  with check (true);

create policy "Allow authenticated full access to questions"
  on questions for all
  to authenticated
  using (true)
  with check (true);

create policy "Allow authenticated full access to filled_forms"
  on filled_forms for all
  to authenticated
  using (true)
  with check (true);

create policy "Allow authenticated full access to form_answers"
  on form_answers for all
  to authenticated
  using (true)
  with check (true);
