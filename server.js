// Auto-deploy test
// Login route deployment verification
// Upload proxy configuration is applied by the backend deploy workflow.
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');

const providersRoutes = require('./routes/providers.routes');
const subscriptionsRoutes = require('./routes/subscriptions.routes');
const bookingsRoutes = require('./routes/bookings.routes');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const pool = require('./config/db');
const { attachRealtime } = require('./services/realtime');

const app = express();

// AWS Elastic Beanstalk runs the Node process behind its reverse proxy.
// Trust the single proxy hop so req.ip reflects the real client IP for rate limiting.
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const configuredOrigins = (process.env.FRONTEND_BASE_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
const allowedOrigins = new Set([
  ...configuredOrigins,
  'https://gofixo-admin.mob13r.com',
  'https://gofixo-app.mob13r.com',
]);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('CORS origin not allowed'));
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-api-key', 'x-publisher-key'],
  optionsSuccessStatus: 204,
}));
// Keep API request bodies bounded; KYC files use multipart handling in their route.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Uploaded KYC documents (Aadhar, DL, RC, photos) — filenames include a random token so URLs aren't guessable
// KYC documents are served only through the authenticated provider document route.
// Do not expose the uploads directory as a public static folder.

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'gofixo-backend' });
});

app.use('/api/providers', providersRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// Generic error handler — never leak raw error details in production
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.name === 'MulterError') {
    const messages = {
      LIMIT_FILE_SIZE: 'File is too large. Maximum size is 15 MB.',
      LIMIT_FILE_COUNT: 'Only one file can be uploaded at a time.',
      LIMIT_UNEXPECTED_FILE: 'Unexpected upload field.',
      LIMIT_PART_COUNT: 'Too many form parts.',
    };
    return res.status(400).json({ error: messages[err.code] || 'File upload failed' });
  }
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? (err.status ? err.message : 'Something went wrong') : err.message
  });
});

// Ensure small additive KYC/push schema changes exist on every deployment.
// This keeps an older production database from returning 500 while migrations are
// being applied manually or by a deployment process.
async function ensureRuntimeSchema() {
  await pool.query(`
    ALTER TABLE service_providers
    ADD COLUMN IF NOT EXISTS kyc_review_note TEXT
  `);

  await pool.query(`
    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS profile_photo_url TEXT,
      ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP DEFAULT NOW()
  `);

  // Customer forgot-password requests. Create this on startup so an older production
  // database cannot return 500 while the Admin Customers page is opened.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id SERIAL PRIMARY KEY,
      customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      resolved_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS password_reset_requests_one_pending
      ON password_reset_requests (customer_id)
      WHERE status = 'pending'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_push_subscriptions (
      id SERIAL PRIMARY KEY,
      provider_id INT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (provider_id, endpoint)
    )
  `);

  // Keep additive booking/payment fields present on older production databases.
  // These are safe no-op changes when the columns/table already exist.
  await pool.query(`
    ALTER TABLE bookings
      ADD COLUMN IF NOT EXISTS payment_confirmed_by_provider BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS route_distance_km NUMERIC(10,2)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS earnings_log (
      id SERIAL PRIMARY KEY,
      booking_id INT REFERENCES bookings(id),
      provider_id INT REFERENCES service_providers(id),
      amount NUMERIC(10,2) NOT NULL,
      added_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS booking_ratings_one_per_side
      ON booking_ratings (booking_id, rated_by)
  `);
}

const PORT = process.env.PORT || 4000;
const httpServer = http.createServer(app);
attachRealtime(httpServer);

ensureRuntimeSchema()
  .then(() => {
    httpServer.listen(PORT, () => console.log(`Gofixo backend running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Database schema setup failed:', err);
    process.exit(1);
  });

// Ride-request timeout: if the provider who is being buzzed doesn't respond within OFFER_TIMEOUT_SECONDS,
// they're put offline and the request moves to the next nearest on-duty provider.
// (Single PM2 process, so a simple interval is enough. Claims in handleDeclineOrTimeout are atomic anyway.)
const OFFER_TIMEOUT_SECONDS = 60;
const STALE_LOCATION_SECONDS = 5 * 60;
setInterval(async () => {
  try {
    // Broadcast requests stay visible/buzzing for 60 seconds. Do not take
    // any provider offline on timeout; they remain online for future requests.
    const expired = await pool.query(
      `UPDATE bookings
       SET status = 'no_provider', offered_at = NULL
       WHERE status = 'requested'
         AND provider_id IS NULL
         AND offered_at IS NOT NULL
         AND offered_at < NOW() - ($1 || ' seconds')::interval
       RETURNING id`,
      [String(OFFER_TIMEOUT_SECONDS)]
    );
    if (expired.rowCount) {
      console.log(`Closed ${expired.rowCount} expired broadcast booking(s)`);
    }
  } catch (err) {
    console.error('Offer timeout sweeper error:', err.message);
  }
}, 5000);

// Provider availability is controlled by the provider. Do not force Offline
// just because a sleeping phone stopped sending GPS updates. Matching still requires
// a fresh location, so a sleeping provider is not offered a new job until GPS resumes.
setInterval(async () => {
  try {
    await pool.query(
      'SELECT COUNT(*) FROM service_providers WHERE is_available = true AND (location_updated_at IS NULL OR location_updated_at <= NOW() - ($1 || \' seconds\')::interval)',
      [String(STALE_LOCATION_SECONDS)]
    );
  } catch (err) {
    console.error('Stale provider check error:', err.message);
  }
}, 60000);
