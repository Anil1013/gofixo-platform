-- Persist the calculated ride distance so provider/customer views can show the route distance.
-- Safe to run more than once.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS route_distance_km NUMERIC(10,2);
