-- Add notes_enabled column to menu_items and breakfast_items tables
-- By default, notes are disabled.

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS notes_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE breakfast_items ADD COLUMN IF NOT EXISTS notes_enabled BOOLEAN DEFAULT FALSE;
