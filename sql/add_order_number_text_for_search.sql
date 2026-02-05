-- Enables partial order number search (e.g. "1022" matches 11022, 10225).
-- Run once in Supabase SQL Editor.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'order_number_text'
  ) THEN
    ALTER TABLE public.orders
    ADD COLUMN order_number_text text GENERATED ALWAYS AS (order_number::text) STORED;
  END IF;
END $$;
