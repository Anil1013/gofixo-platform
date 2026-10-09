-- Ride-request offers: nearest on-duty provider gets the request first; decline/timeout moves it to the next nearest
ALTER TABLE bookings ADD COLUMN provider_type VARCHAR(20);
ALTER TABLE bookings ADD COLUMN offered_at TIMESTAMP;
ALTER TABLE bookings ADD COLUMN declined_providers INT[] DEFAULT '{}';
