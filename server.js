// Auto-deploy test
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');

const providersRoutes = require('./routes/providers.routes');
const subscriptionsRoutes = require('./routes/subscriptions.routes');
const bookingsRoutes = require('./routes/bookings.routes');
const authRoutes = require('./routes/auth.routes');
const pool = require('./config/db');
const { handleDeclineOrTimeout } = require('./services/matching');

const app = express();

// AWS Elastic Beanstalk/reverse-proxy deployments can forward the real client IP.
// Keep this opt-in so direct deployments do not blindly trust spoofed proxy headers.
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = (process.env.FRONTEND_BASE_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : '*' }));
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

// Generic error handler — never leak raw error details in production
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Gofixo backend running on port ${PORT}`));

// Ride-request timeout: if the provider who is being buzzed doesn't respond within OFFER_TIMEOUT_SECONDS,
// they're put offline and the request moves to the next nearest on-duty provider.
// (Single PM2 process, so a simple interval is enough. Claims in handleDeclineOrTimeout are atomic anyway.)
const OFFER_TIMEOUT_SECONDS = 30;
const STALE_LOCATION_SECONDS = 5 * 60;
setInterval(async () => {
  try {
    const expired = await pool.query(
      `SELECT id FROM bookings
       WHERE status = 'requested' AND offered_at IS NOT NULL
         AND offered_at < NOW() - ($1 || ' seconds')::interval`,
      [String(OFFER_TIMEOUT_SECONDS)]
    );
    for (const row of expired.rows) {
      // Coordinate timeout processing across multiple backend instances.
      // The advisory lock is per booking, so unrelated expired offers can still progress concurrently.
      const lock = await pool.query(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        [2147483646, row.id]
      );
      if (!lock.rows[0].locked) continue;

      try {
        await handleDeclineOrTimeout(row.id, true);
      } finally {
        await pool.query(
          'SELECT pg_advisory_unlock($1, $2)',
          [2147483646, row.id]
        );
      }
    }
  } catch (err) {
    console.error('Offer timeout sweeper error:', err.message);
  }
}, 5000);

// Keep provider availability state consistent with the 5-minute matching freshness rule.
setInterval(async () => {
  try {
    await pool.query(
      `UPDATE service_providers sp
       SET is_available = false
       WHERE sp.is_available = true
         AND (sp.location_updated_at IS NULL
              OR sp.location_updated_at <= NOW() - ($1 || ' seconds')::interval)
         AND NOT EXISTS (
           SELECT 1 FROM bookings b
           WHERE b.provider_id = sp.id
             AND b.status IN ('accepted', 'ongoing')
         )`,
      [String(STALE_LOCATION_SECONDS)]
    );
  } catch (err) {
    console.error('Stale provider sweeper error:', err.message);
  }
}, 60000);
