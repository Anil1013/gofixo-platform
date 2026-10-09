-- Production provider location freshness support.
-- Run this migration once against the existing Gofixo database.

ALTER TABLE service_providers
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS service_providers_available_location_idx
  ON service_providers (type, is_available, location_updated_at);
-- Existing rows have no trustworthy freshness timestamp, so they must re-share location
-- before becoming eligible for new bookings.
UPDATE service_providers
SET is_available = false
WHERE location_updated_at IS NULL;