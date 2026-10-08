-- Gofixo home-service isolation: explicit specialization and request details.
ALTER TABLE service_providers
  ADD COLUMN IF NOT EXISTS service_categories TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS service_category VARCHAR(50),
  ADD COLUMN IF NOT EXISTS service_description TEXT;

CREATE INDEX IF NOT EXISTS bookings_service_category_idx
  ON bookings (service_type, service_category);

CREATE INDEX IF NOT EXISTS service_providers_service_categories_gin_idx
  ON service_providers USING GIN (service_categories);
