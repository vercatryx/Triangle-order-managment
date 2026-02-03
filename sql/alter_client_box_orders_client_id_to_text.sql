-- client_box_orders.client_id was UUID (references clients(id)).
-- App uses text client ids (e.g. CLIENT-1063). This migration aligns the column type.
-- Prerequisite: clients.id must be TEXT (e.g. CLIENT-xxx).
--
-- Run in Supabase SQL Editor. If you get "relation client_box_orders does not exist",
-- check you're in the right project/schema (usually public).

-- 1. Drop ANY foreign key on client_box_orders.client_id (constraint name may vary)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
        WHERE c.conrelid = 'client_box_orders'::regclass
          AND c.contype = 'f'
          AND a.attname = 'client_id'
    ) LOOP
        EXECUTE format('ALTER TABLE client_box_orders DROP CONSTRAINT %I', r.conname);
        RAISE NOTICE 'Dropped constraint %', r.conname;
    END LOOP;
END $$;

-- 2. Allow NULL temporarily so we can change type
ALTER TABLE client_box_orders
  ALTER COLUMN client_id DROP NOT NULL;

-- 3. Change type: existing UUIDs become their string form; new rows will use CLIENT-xxx
ALTER TABLE client_box_orders
  ALTER COLUMN client_id TYPE TEXT USING client_id::text;

-- 4. Restore NOT NULL
ALTER TABLE client_box_orders
  ALTER COLUMN client_id SET NOT NULL;

-- 5. Re-add FK to clients(id) only if clients.id is TEXT (skip if this fails)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'id'
        AND data_type = 'text'
    ) THEN
        ALTER TABLE client_box_orders
          ADD CONSTRAINT client_box_orders_client_id_fkey
          FOREIGN KEY (client_id) REFERENCES clients(id);
        RAISE NOTICE 'Added FK client_box_orders_client_id_fkey';
    ELSE
        RAISE NOTICE 'Skipped FK: clients.id is not text';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not add FK (non-fatal): %', SQLERRM;
END $$;

-- Verify: run this after migration; should show "character varying" or "text"
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'client_box_orders' AND column_name = 'client_id';
