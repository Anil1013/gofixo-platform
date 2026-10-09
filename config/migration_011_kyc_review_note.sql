-- Store the latest KYC review message so providers can see exactly what needs correction.
-- Safe to run more than once.
ALTER TABLE service_providers
  ADD COLUMN IF NOT EXISTS kyc_review_note TEXT;
