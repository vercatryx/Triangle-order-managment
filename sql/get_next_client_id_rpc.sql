-- Atomic next client ID to avoid duplicate key under concurrency.
-- Run in Supabase SQL Editor. After first deploy, run the setval once (see comment at end).

-- 1. Sequence for CLIENT-NNN ids
CREATE SEQUENCE IF NOT EXISTS client_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

-- 2. RPC: returns next ID. Always syncs sequence to max(existing) then takes next value,
--    so the correct sequence is used regardless of schema and we never return an existing ID.
CREATE OR REPLACE FUNCTION get_next_client_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_existing INTEGER;
  n INTEGER;
BEGIN
  SELECT COALESCE(MAX(
    (regexp_match(id, '^CLIENT-(\d+)$'))[1]::integer
  ), 0) INTO max_existing
  FROM clients
  WHERE id ~ '^CLIENT-[0-9]+$';

  PERFORM setval('public.client_id_seq', max_existing);
  n := nextval('public.client_id_seq');

  RETURN 'CLIENT-' || lpad(n::text, 3, '0');
END;
$$;

-- 3. One-time init: set sequence so next value is max(existing)+1 (run once after deploy if you have existing clients)
-- SELECT setval('client_id_seq', (
--   SELECT COALESCE(MAX((regexp_match(id, '^CLIENT-(\d+)$'))[1]::integer), 0)
--   FROM clients WHERE id ~ '^CLIENT-[0-9]+$'
-- ));
