-- One-off: sync client_id_seq so next nextval() is max(existing CLIENT-NNN) + 1.
-- Run in Supabase SQL Editor, or call via RPC sync_client_id_sequence() after creating the function below.
-- This fixes "duplicate key clients_pkey" when the sequence was behind.

-- Option A: Run directly in SQL Editor:
SELECT setval('client_id_seq', (
  SELECT COALESCE(MAX((regexp_match(id, '^CLIENT-(\d+)$'))[1]::integer), 0)
  FROM clients WHERE id ~ '^CLIENT-[0-9]+$'
));

-- Option B: Create an RPC so the app or scripts can sync (run this once, then call from code).
CREATE OR REPLACE FUNCTION sync_client_id_sequence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_val integer;
BEGIN
  SELECT COALESCE(MAX((regexp_match(id, '^CLIENT-(\d+)$'))[1]::integer), 0) INTO max_val
  FROM clients WHERE id ~ '^CLIENT-[0-9]+$';
  PERFORM setval('public.client_id_seq', max_val);
END;
$$;
