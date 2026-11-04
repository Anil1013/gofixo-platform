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
