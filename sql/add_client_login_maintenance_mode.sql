-- Add client_login_maintenance_mode column to app_settings table.
-- When true: clients see maintenance message and cannot log in (OTP/password disabled).
-- When false: clients can log in as normal.
-- Run this in your Supabase SQL editor or migration pipeline.

ALTER TABLE public.app_settings
ADD COLUMN IF NOT EXISTS client_login_maintenance_mode BOOLEAN DEFAULT true;

COMMENT ON COLUMN public.app_settings.client_login_maintenance_mode IS 'When true, client login is disabled and clients see a maintenance message. When false, clients can log in with OTP.';
