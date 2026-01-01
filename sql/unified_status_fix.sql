-- 1. Drop existing check constraints first so we can update the data freely
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.upcoming_orders DROP CONSTRAINT IF EXISTS upcoming_orders_status_check;

-- 2. Clean up any invalid or NULL statuses
-- We ensure every row has a valid status before re-adding the constraint.
-- If a status is missing or not in our allowed list, we set it to 'processed'
UPDATE public.orders 
SET status = 'processed' 
WHERE status IS NULL 
   OR status NOT IN ('scheduled', 'processed', 'delivered');

UPDATE public.upcoming_orders 
SET status = 'processed' 
WHERE status IS NULL 
   OR status NOT IN ('scheduled', 'processed', 'delivered');

-- 3. Add the new, expanded check constraints
-- This allows:
-- 'scheduled': For orders/upcoming orders that are planned
-- 'processed': For orders that have been synced/handled
-- 'delivered': For orders where proof has been uploaded
ALTER TABLE public.orders 
ADD CONSTRAINT orders_status_check 
CHECK (status IN ('scheduled', 'processed', 'delivered'));

ALTER TABLE public.upcoming_orders 
ADD CONSTRAINT upcoming_orders_status_check 
CHECK (status IN ('scheduled', 'processed', 'delivered'));

-- 4. Verify the results (optional but helpful)
SELECT count(*) as count_orders, status FROM public.orders GROUP BY status;
