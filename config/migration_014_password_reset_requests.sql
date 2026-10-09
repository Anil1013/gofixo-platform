-- Customer password reset requests
-- The request itself never changes the password. Admin approval/reset is required.

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_requests_one_pending
  ON password_reset_requests (customer_id)
  WHERE status = 'pending';
