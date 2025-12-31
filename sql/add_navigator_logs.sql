-- Create table for logging navigator actions
CREATE TABLE IF NOT EXISTS public.navigator_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    navigator_id UUID NOT NULL REFERENCES public.navigators(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    old_status TEXT,
    new_status TEXT,
    units_added INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for faster filtering by navigator
CREATE INDEX IF NOT EXISTS idx_navigator_logs_navigator_id ON public.navigator_logs(navigator_id);
-- Index for faster filtering by client
CREATE INDEX IF NOT EXISTS idx_navigator_logs_client_id ON public.navigator_logs(client_id);
