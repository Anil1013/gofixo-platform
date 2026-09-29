-- Add ride drop coordinates for in-app routing and fare calculation.
-- Safe to run more than once.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS drop_lat NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS drop_lng NUMERIC(9,6);
