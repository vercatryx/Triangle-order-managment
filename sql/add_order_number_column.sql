-- Create a shared sequence starting at 100001
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq
    START WITH 100001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Add order_number to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS order_number BIGINT DEFAULT nextval('public.order_number_seq');

-- Add order_number to upcoming_orders table
ALTER TABLE public.upcoming_orders
ADD COLUMN IF NOT EXISTS order_number BIGINT DEFAULT nextval('public.order_number_seq');

-- Create a unique index to ensure we don't have duplicates (optional but good practice)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON public.orders(order_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_upcoming_orders_order_number ON public.upcoming_orders(order_number);

-- Backfill existing orders orders ordered by creation time
-- We use a temporary sequence or window function to assign numbers to existing rows 
-- that might have nulls if the default didn't populate (it usually populates for new, not existing)
WITH numbered_orders AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) + 100000 as new_number
  FROM public.orders
  WHERE order_number IS NULL
)
UPDATE public.orders
SET order_number = numbered_orders.new_number
FROM numbered_orders
WHERE public.orders.id = numbered_orders.id;

-- Backfill upcoming_orders
-- We pick up where we left off or just use the sequence if we want, 
-- but safer to just use row_number offset by the max of orders to avoid collision if run sequentially
-- actually, let's just use the sequence for simplicity or a safe offset.
-- For safety/simplicity in this script, let's just assign from the sequence for existing upcoming_orders
-- Note: calling nextval for every row in update
UPDATE public.upcoming_orders
SET order_number = nextval('public.order_number_seq')
WHERE order_number IS NULL;

-- Ensure the sequence is set to the max value + 1 to avoid conflicts
SELECT setval('public.order_number_seq', (
  SELECT GREATEST(
    COALESCE(MAX(order_number), 100000), 
    (SELECT COALESCE(MAX(order_number), 100000) FROM public.upcoming_orders)
  ) 
  FROM public.orders
) + 1);
