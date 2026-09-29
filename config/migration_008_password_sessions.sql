-- Invalidate JWT sessions issued before a password change.
-- Safe to run more than once.
ALTER TABLE service_providers
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP DEFAULT NOW();

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP DEFAULT NOW();

UPDATE service_providers
SET password_changed_at = COALESCE(password_changed_at, NOW());

UPDATE customers
SET password_changed_at = COALESCE(password_changed_at, NOW());
