-- Adds live location tracking, needed for nearest-provider matching
ALTER TABLE service_providers ADD COLUMN current_lat NUMERIC(9,6);
ALTER TABLE service_providers ADD COLUMN current_lng NUMERIC(9,6);
ALTER TABLE bookings ADD COLUMN pickup_lat NUMERIC(9,6);
ALTER TABLE bookings ADD COLUMN pickup_lng NUMERIC(9,6);
