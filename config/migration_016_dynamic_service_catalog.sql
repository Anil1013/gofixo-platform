-- Dynamic home-service catalog. Safe to apply more than once.
CREATE TABLE IF NOT EXISTS service_catalog (
  id BIGSERIAL PRIMARY KEY,
  category_key VARCHAR(60) NOT NULL UNIQUE,
  label VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  provider_type VARCHAR(30) NOT NULL CHECK (provider_type IN ('general_worker','skilled_worker')),
  base_fare NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (base_fare >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS service_catalog_active_order_idx
  ON service_catalog (is_active, sort_order, label);

-- Seed the existing service set once. Admin edits are preserved on reruns.
INSERT INTO service_catalog
  (category_key,label,description,image_url,provider_type,base_fare,is_active,sort_order,metadata)
VALUES
('electrician','Electrician','','https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=700&q=82','skilled_worker',299,true,10,'{}'::jsonb),
('plumber','Plumber','','https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?auto=format&fit=crop&w=700&q=82','skilled_worker',299,true,20,'{}'::jsonb),
('ac_service','AC Service','','https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=700&q=82','skilled_worker',399,true,30,'{}'::jsonb),
('cleaning','Cleaning','','https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=700&q=82','general_worker',349,true,40,'{}'::jsonb),
('painter','Painter','','https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=700&q=82','skilled_worker',499,true,50,'{}'::jsonb),
('carpenter','Carpenter','','https://images.unsplash.com/photo-1601058268499-e52658a84c9d?auto=format&fit=crop&w=700&q=82','skilled_worker',399,true,60,'{}'::jsonb),
('appliance_repair','Appliance Repair','','https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=700&q=82','skilled_worker',399,true,70,'{}'::jsonb),
('refrigerator_repair','Refrigerator Repair','','https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&w=700&q=82','skilled_worker',449,true,80,'{}'::jsonb),
('washing_machine_repair','Washing Machine Repair','','https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?auto=format&fit=crop&w=700&q=82','skilled_worker',449,true,90,'{}'::jsonb),
('ro_water_purifier','RO & Water Purifier','','https://images.unsplash.com/photo-1584438784894-089d6a62b8fa?auto=format&fit=crop&w=700&q=82','skilled_worker',349,true,100,'{}'::jsonb),
('cctv_security','CCTV & Security','','https://images.unsplash.com/photo-1557597774-9d273605dfa9?auto=format&fit=crop&w=700&q=82','skilled_worker',499,true,110,'{}'::jsonb),
('internet_wifi','Internet & Wi-Fi','','https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=700&q=82','skilled_worker',299,true,120,'{}'::jsonb),
('geyser_repair','Geyser Repair','','https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=700&q=82','skilled_worker',399,true,130,'{}'::jsonb),
('pest_control','Pest Control','','https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=700&q=82','general_worker',399,true,140,'{}'::jsonb),
('packers_movers','Packers & Movers','','https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=700&q=82','general_worker',799,true,150,'{}'::jsonb),
('salon_beauty','Salon & Beauty','','https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=700&q=82','general_worker',499,true,160,'{}'::jsonb),
('cook','Cook','','https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=700&q=82','general_worker',499,true,170,'{}'::jsonb),
('gardener','Gardener','','https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=700&q=82','general_worker',299,true,180,'{}'::jsonb),
('laundry','Laundry','','https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&w=700&q=82','general_worker',299,true,190,'{}'::jsonb),
('driver','Personal Driver','','https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?auto=format&fit=crop&w=700&q=82','general_worker',599,true,200,'{}'::jsonb),
('tutor','Tutor','','https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=700&q=82','general_worker',399,true,210,'{}'::jsonb),
('babysitter','Babysitter','','https://images.unsplash.com/photo-1491013516836-7db643ee125a?auto=format&fit=crop&w=700&q=82','general_worker',499,true,220,'{}'::jsonb),
('elder_care','Senior & Disability Care','','https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=700&q=82','general_worker',599,true,230,'{}'::jsonb),
('other','Other Service','','https://images.unsplash.com/photo-1521791055366-0d553872125f?auto=format&fit=crop&w=700&q=82','general_worker',299,true,240,'{}'::jsonb)
ON CONFLICT (category_key) DO NOTHING;
