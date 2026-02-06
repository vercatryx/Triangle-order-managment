-- Add send_vendor_next_week_emails column to app_settings table
-- When true, "Create orders for the next week" will email each vendor their order count by day.

ALTER TABLE app_settings
ADD COLUMN IF NOT EXISTS send_vendor_next_week_emails BOOLEAN DEFAULT true;

COMMENT ON COLUMN app_settings.send_vendor_next_week_emails IS 'When true, vendors receive an email with their order count for next week (by day) after Create orders for the next week.';
