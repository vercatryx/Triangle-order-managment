-- Add column to track if status requires units to be added when switching to it
ALTER TABLE client_statuses 
ADD COLUMN requires_units_on_change BOOLEAN DEFAULT FALSE;




