-- Drop existing check constraint on orders status if it exists
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- Add new check constraint allowing 'delivered' status (and other existing statuses)
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN ('scheduled', 'processed', 'delivered'));

-- If there is a similar constraint on upcoming_orders, adjust it as well
ALTER TABLE public.upcoming_orders DROP CONSTRAINT IF EXISTS upcoming_orders_status_check;
ALTER TABLE public.upcoming_orders ADD CONSTRAINT upcoming_orders_status_check CHECK (status IN ('scheduled', 'processed', 'delivered'));
