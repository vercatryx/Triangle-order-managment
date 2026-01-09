CREATE TABLE IF NOT EXISTS client_box_orders (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  case_id TEXT,
  box_type_id UUID REFERENCES box_types(id),
  vendor_id UUID REFERENCES vendors(id),
  quantity INTEGER DEFAULT 1,
  items JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
