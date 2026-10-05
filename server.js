// Auto-deploy test
// Login route deployment verification
// Upload proxy configuration is applied by the backend deploy workflow.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const fs = require('fs');
const path = require('path');

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

const RELEASE_COMMIT = process.env.GOFIXO_RELEASE_COMMIT || 'unknown';

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'gofixo-backend',
    releaseCommit: RELEASE_COMMIT,
  });
});

const OTA_DIR = path.join(__dirname, 'ota');
const OTA_MANIFEST = path.join(OTA_DIR, 'latest.json');

app.get('/api/mobile/ota/check', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const appVersionCode = Number.parseInt(String(req.query.app_version_code || ''), 10);
    const abi = String(req.query.abi || '');
    const currentPatch = String(req.query.current_patch || '');
    if (!Number.isFinite(appVersionCode) || !abi) return res.json({ hasUpdate: false });

    const latest = JSON.parse(fs.readFileSync(OTA_MANIFEST, 'utf8'));
    const patch = latest.patches?.[abi];
    if (!patch || Number(patch.targetVersionCode) !== appVersionCode) return res.json({ hasUpdate: false });
    if (currentPatch && currentPatch === patch.version) return res.json({ hasUpdate: false });

    return res.json({
      hasUpdate: true,
      patch: {
        version: patch.version,
        patchUrl: `https://gofixo.mob13r.com/api/mobile/ota/files/${encodeURIComponent(patch.filename)}`,
        md5: patch.md5,
        signature: patch.signature || '',
        targetVersionCode: Number(patch.targetVersionCode)
      },
      shouldForceUpdate: true,
      message: latest.message || 'A new Gofixo update is ready.',
      gitCommitHash: latest.gitCommitHash || ''
    });
  } catch (err) {
    console.error('OTA check error:', err.message);
    return res.json({ hasUpdate: false });
  }
});

app.use('/api/mobile/ota/files', express.static(OTA_DIR, {
  index: false,
  dotfiles: 'deny',
  setHeaders(res) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));


const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

async function googlePlacesRequest(url, fieldMask, body) {
  if (!GOOGLE_MAPS_API_KEY) {
    const err = new Error('Google Places is not configured on the Gofixo server');
    err.status = 503;
    throw err;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error?.message || 'Google Places request failed');
    err.status = response.status >= 500 ? 502 : 400;
    throw err;
  }
  return data;
}

app.get('/api/places/autocomplete', async (req, res) => {
  const input = String(req.query.input || '').trim();
  if (input.length < 2) return res.json({ suggestions: [] });

  try {
    const data = await googlePlacesRequest(
      'https://places.googleapis.com/v1/places:autocomplete',
      'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.queryPrediction.text',
      {
        input,
        languageCode: 'en',
        regionCode: 'IN',
        ...(String(req.query.sessionToken || '').trim()
          ? { sessionToken: String(req.query.sessionToken).trim() }
          : {}),
      },
    );

    const suggestions = (data.suggestions || []).map((item) => {
      const p = item.placePrediction;
      if (p) {
        return {
          type: 'place',
          placeId: p.placeId,
          text: p.text?.text || '',
          mainText: p.structuredFormat?.mainText?.text || p.text?.text || '',
          secondaryText: p.structuredFormat?.secondaryText?.text || '',
        };
      }
      const q = item.queryPrediction;
      return q ? {
        type: 'query',
        placeId: null,
        text: q.text?.text || '',
        mainText: q.text?.text || '',
        secondaryText: '',
      } : null;
    }).filter(Boolean);

    res.json({ suggestions });
  } catch (err) {
    console.error('Google Places autocomplete error:', err.message);
    res.status(err.status || 502).json({ error: err.message || 'Address search failed' });
  }
});

app.get('/api/places/details/:placeId', async (req, res) => {
  const placeId = String(req.params.placeId || '').trim();
  if (!placeId) return res.status(400).json({ error: 'Place ID is required' });

  try {
    const sessionToken = String(req.query.sessionToken || '').trim();
    const query = sessionToken
      ? '?sessionToken=' + encodeURIComponent(sessionToken)
      : '';
    const url = 'https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId) + query;
    const response = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data?.error?.message || 'Google Place details failed');
      err.status = response.status >= 500 ? 502 : 400;
      throw err;
    }
    res.json({
      placeId: data.id || placeId,
      name: data.displayName?.text || '',
      address: data.formattedAddress || '',
      lat: data.location?.latitude,
      lng: data.location?.longitude,
    });
  } catch (err) {
    console.error('Google Place details error:', err.message);
    res.status(err.status || 502).json({ error: err.message || 'Address details failed' });
  }
});

app.get('/api/places/resolve', async (req, res) => {
  const input = String(req.query.input || '').trim();
  if (!input) return res.status(400).json({ error: 'Address is required' });

  try {
    const data = await googlePlacesRequest(
      'https://places.googleapis.com/v1/places:searchText',
      'places.id,places.displayName,places.formattedAddress,places.location',
      {
        textQuery: input,
        languageCode: 'en',
        regionCode: 'IN',
        maxResultCount: 5,
      },
    );

    const places = (data.places || []).map((p) => ({
      placeId: p.id || '',
      name: p.displayName?.text || '',
      address: p.formattedAddress || '',
      lat: p.location?.latitude,
      lng: p.location?.longitude,
    })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    if (!places.length) return res.status(404).json({ error: 'Destination not found' });
    res.json({ place: places[0], candidates: places });
  } catch (err) {
    console.error('Google Place resolve error:', err.message);
    res.status(err.status || 502).json({ error: err.message || 'Address search failed' });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      service: 'gofixo-backend',
      database: 'ok',
      releaseCommit: RELEASE_COMMIT,
    });
  } catch (err) {
    console.error('Health database check failed:', err.message);
    res.status(503).json({
      status: 'degraded',
      service: 'gofixo-backend',
      database: 'error',
      releaseCommit: RELEASE_COMMIT,
    });
  }
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

// Ride-request timeout: close an unclaimed broadcast request after OFFER_TIMEOUT_SECONDS.
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
