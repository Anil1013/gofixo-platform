-- Home-service inspection quotes and customer approvals. Safe to rerun.
CREATE TABLE IF NOT EXISTS service_job_quotes (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider_id BIGINT NOT NULL REFERENCES service_providers(id),
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL CHECK (status IN ('proposed','approved','declined','superseded')),
  description TEXT NOT NULL,
  labour_amount NUMERIC(12,2) NOT NULL CHECK (labour_amount >= 0),
  visit_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (visit_fee_amount >= 0),
  visit_fee_credit_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (visit_fee_credit_amount >= 0),
  service_amount NUMERIC(12,2) NOT NULL CHECK (service_amount >= 0),
  materials_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (materials_amount >= 0),
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  materials JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_response_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS service_job_quotes_booking_idx
  ON service_job_quotes (booking_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS service_job_quotes_one_pending_idx
  ON service_job_quotes (booking_id) WHERE status = 'proposed';
