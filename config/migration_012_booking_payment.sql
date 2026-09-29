-- Keep production booking/payment schema compatible with the current backend.
-- Safe to run more than once.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_confirmed_by_provider BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS earnings_log (
  id SERIAL PRIMARY KEY,
  booking_id INT REFERENCES bookings(id),
  provider_id INT REFERENCES service_providers(id),
  amount NUMERIC(10,2) NOT NULL,
  added_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_ratings_one_per_side
  ON booking_ratings (booking_id, rated_by);
