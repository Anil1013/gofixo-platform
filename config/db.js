const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Small, idempotent production-safe schema bootstrap for fields required by live matching.
// PostgreSQL serializes the ALTER TABLE operation, and IF NOT EXISTS makes restarts harmless.
pool.query(`
  ALTER TABLE service_providers
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMP
`).then(() => pool.query(`
  CREATE INDEX IF NOT EXISTS idx_service_providers_matching
  ON service_providers (type, is_available, kyc_status, location_updated_at)
`)).catch((err) => {
  console.error('Gofixo DB bootstrap error:', err.message);
});

module.exports = pool;
