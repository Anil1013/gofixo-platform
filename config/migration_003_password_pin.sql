-- Password-based login (replaces OTP) + booking start PIN (replaces OTP-based ride verification)
ALTER TABLE customers ADD COLUMN password_hash TEXT;
ALTER TABLE service_providers ADD COLUMN password_hash TEXT;
ALTER TABLE bookings ADD COLUMN start_pin VARCHAR(4);
