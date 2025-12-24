
ALTER TABLE box_types 
ADD COLUMN vendor_id UUID REFERENCES vendors(id);
