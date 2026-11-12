const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { sendProviderPush, sendProviderFcm, sendCustomerFcm } = require('../services/push');
const { normalizeServiceCategory, getServiceBaseFare } = require('../services/catalog');
const { resolveServiceCatalogBooking } = require('../services/service-catalog-booking');
const { calculateRideFare } = require('../services/ride-pricing');

const SERVICE_TYPES = new Set(['ride', 'services']);
const PROVIDER_TYPES = new Set(['bike', 'auto', 'car', 'general_worker', 'skilled_worker']);

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

async function getAuthoritativeRideDistanceKm(originLat, originLng, destinationLat, destinationLng) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    const error = new Error('Google Routes is not configured on the Gofixo server');
    error.status = 503;
    throw error;
  }
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
      destination: { location: { latLng: { latitude: destinationLat, longitude: destinationLng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: false,
      languageCode: 'en-IN',
      units: 'METRIC',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Google Routes could not verify the ride distance');
    error.status = response.status >= 500 ? 502 : 400;
    throw error;
  }
  const meters = Number(data?.routes?.[0]?.distanceMeters);
  if (!Number.isFinite(meters) || meters <= 0) {
    const error = new Error('No valid drivable route was found for this ride');
    error.status = 422;
    throw error;
  }
  return meters / 1000;
}

async function reserveServiceWallet(client, customerId, bookingId, amount) {
  const wallet = await client.query(
    'SELECT * FROM wallets WHERE customer_id = $1 FOR UPDATE',
    [customerId]
  );
  if (wallet.rows.length === 0 || Number(wallet.rows[0].available_balance) < amount) {
    return false;
  }
  const w = wallet.rows[0];
  const before = Number(w.available_balance);
  const reservedBefore = Number(w.reserved_balance);
  const after = money(before - amount);
  const reservedAfter = money(reservedBefore + amount);
  await client.query(
    `UPDATE wallets SET available_balance = $1, reserved_balance = $2, updated_at = NOW() WHERE id = $3`,
    [after, reservedAfter, w.id]
  );
  await client.query(
    `INSERT INTO wallet_transactions
      (wallet_id, customer_id, booking_id, type, amount, balance_before, balance_after,
       reserved_before, reserved_after, status, reference_id, metadata)
     VALUES ($1, $2, $3, 'BOOKING_RESERVE', $4, $5, $6, $7, $8, 'success', $9, $10)
     ON CONFLICT (type, reference_id) DO NOTHING`,
    [w.id, customerId, bookingId, amount, before, after, reservedBefore, reservedAfter,
      'BOOKING_RESERVE_' + bookingId,
      JSON.stringify({ service_type: 'services' })]
  );
  return true;
}

async function releaseServiceWallet(client, bookingId, customerId, amount, reason) {
  const tx = await client.query(
    `SELECT wt.*, w.available_balance, w.reserved_balance
     FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id
     WHERE wt.booking_id = $1 AND wt.type = 'BOOKING_RESERVE' AND wt.status = 'success'
     FOR UPDATE`,
    [bookingId]
  );
  if (!tx.rows.length) return false;
  const row = tx.rows[0];
  const releaseAmount = money(amount || row.amount);
  const before = Number(row.available_balance);
  const reservedBefore = Number(row.reserved_balance);
  const after = money(before + releaseAmount);
  const reservedAfter = money(Math.max(0, reservedBefore - releaseAmount));
  await client.query('UPDATE wallets SET available_balance=$1, reserved_balance=$2, updated_at=NOW() WHERE id=$3', [after, reservedAfter, row.wallet_id]);
  await client.query(
    `INSERT INTO wallet_transactions
      (wallet_id, customer_id, booking_id, type, amount, balance_before, balance_after,
       reserved_before, reserved_after, status, reference_id, metadata)
     VALUES ($1,$2,$3,'BOOKING_RELEASE',$4,$5,$6,$7,$8,'success',$9,$10)
     ON CONFLICT (type, reference_id) DO NOTHING`,
    [row.wallet_id, customerId, bookingId, releaseAmount, before, after, reservedBefore, reservedAfter,
      'BOOKING_RELEASE_' + bookingId,
      JSON.stringify({ reason })]
  );
  await client.query("UPDATE wallet_transactions SET status='released' WHERE id=$1", [row.id]);
  return true;
}

async function captureServiceWallet(client, bookingId, customerId, amount) {
  const tx = await client.query(
    `SELECT wt.*, w.available_balance, w.reserved_balance
     FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id
     WHERE wt.booking_id = $1 AND wt.type = 'BOOKING_RESERVE' AND wt.status = 'success'
     FOR UPDATE`,
    [bookingId]
  );
  if (!tx.rows.length) return false;
  const row = tx.rows[0];
  const captureAmount = money(amount);
  if (Number(row.amount) + 0.01 < captureAmount) return false;
  const before = Number(row.available_balance);
  const reservedBefore = Number(row.reserved_balance);
  const after = before;
  const reservedAfter = money(Math.max(0, reservedBefore - captureAmount));
  await client.query('UPDATE wallets SET reserved_balance=$1, updated_at=NOW() WHERE id=$2', [reservedAfter, row.wallet_id]);
  await client.query(
    `INSERT INTO wallet_transactions
      (wallet_id, customer_id, booking_id, type, amount, balance_before, balance_after,
       reserved_before, reserved_after, status, reference_id, metadata)
     VALUES ($1,$2,$3,'BOOKING_CAPTURE',$4,$5,$6,$7,$8,'success',$9,$10)
     ON CONFLICT (type, reference_id) DO NOTHING`,
    [row.wallet_id, customerId, bookingId, captureAmount, before, after, reservedBefore, reservedAfter,
      'BOOKING_CAPTURE_' + bookingId,
      JSON.stringify({ platform_settlement: true })]
  );
  await client.query("UPDATE wallet_transactions SET status='captured' WHERE id=$1", [row.id]);
  return true;
}

function generatePin() {
  return String(crypto.randomInt(1000, 10000)); // cryptographically secure 4-digit PIN
}

// Booking lifecycle:
//   requested  -> offered to the nearest on-duty provider (their app buzzes); they have a short window to respond
//   accepted   -> provider accepted and is on the way; customer's PIN is needed to start
//   ongoing    -> provider entered the correct PIN
//   completed  -> provider confirmed payment
//   no_provider-> everyone nearby declined / missed it

// Waiting policy: starts when the provider marks arrival. Rates are rupees, not paise.
const WAITING_RATE_PER_MINUTE = 0.50;
const WAITING_LIMIT_MINUTES = 15;
let waitingSchemaReady;
function ensureWaitingSchema() {
  if (!waitingSchemaReady) {
    waitingSchemaReady = pool.query(`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS waiting_fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS waiting_fee_status TEXT NOT NULL DEFAULT 'not_applicable'
    `).catch((err) => {
      waitingSchemaReady = null;
      console.error('[Gofixo waiting policy] Could not prepare booking columns:', err.message);
      throw err;
    });
  }
  return waitingSchemaReady;
}

// Run on the server as well as on API requests, so timeout cancellation does not
// depend on a customer/provider keeping the app open. This applies to rides AND
// home-service jobs; only rides accrue the separate PIN waiting fee.
async function expireWaitingBookings() {
  await ensureWaitingSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expired = await client.query(
      `UPDATE bookings b
          SET status = 'cancelled',
              waiting_fee_amount = CASE
                WHEN b.service_type = 'ride' THEN LEAST($1, GREATEST(0,
                  CEIL(EXTRACT(EPOCH FROM (NOW() - b.arrived_at)) / 60) * $2))
                ELSE 0
              END,
              waiting_fee_status = CASE
                WHEN b.service_type = 'ride' THEN 'due'
                ELSE 'not_applicable'
              END,
              start_pin = NULL,
              offered_at = NULL
         FROM customers c
        WHERE b.customer_id = c.id
          AND b.status = 'arrived'
          AND b.arrived_at IS NOT NULL
          AND b.arrived_at <= NOW() - ($3 * INTERVAL '1 minute')
        RETURNING b.id, b.service_type, b.customer_id, b.provider_id,
                  b.fare_amount, c.fcm_token`,
      [WAITING_RATE_PER_MINUTE * WAITING_LIMIT_MINUTES, WAITING_RATE_PER_MINUTE, WAITING_LIMIT_MINUTES]
    );

    for (const row of expired.rows) {
      if (row.service_type === 'services') {
        await releaseServiceWallet(
          client, row.id, row.customer_id, Number(row.fare_amount),
          'partner_arrival_timeout'
        );
      }
    }

    const providerIds = [...new Set(
      expired.rows.filter((row) => row.provider_id !== null && row.provider_id !== undefined).map((row) => Number(row.provider_id)).filter(Number.isInteger)
    )];
    if (providerIds.length) {
      await client.query(
        `UPDATE service_providers sp
            SET is_available = true
          WHERE sp.is_available = false
            AND sp.id = ANY($1::int[])
            AND NOT EXISTS (
              SELECT 1 FROM bookings active
               WHERE active.provider_id = sp.id
                 AND active.status IN ('accepted', 'arrived', 'ongoing')
            )
            AND sp.kyc_status = 'approved'
            AND sp.location_updated_at >= NOW() - INTERVAL '3 minutes'
            AND EXISTS (
              SELECT 1 FROM provider_skills skill
               WHERE skill.provider_id = sp.id
                 AND skill.kyc_status = 'approved'
                 AND skill.is_available = true
                 AND skill.service_type = CASE WHEN sp.type IN ('bike','auto','car') THEN 'ride' ELSE 'services' END
                 AND (skill.service_type <> 'ride' OR skill.skill_key = sp.type)
            )
            AND (sp.type NOT IN ('bike','auto','car') OR EXISTS (
              SELECT 1 FROM provider_subscriptions ps
               WHERE ps.provider_id = sp.id
                 AND ps.status = 'active'
                 AND ps.expiry_date > NOW()
            ))`,
        [providerIds]
      );
    }
    await client.query('COMMIT');

    for (const row of expired.rows) {
      if (!row.fcm_token) continue;
      const sent = await sendCustomerFcm(row.fcm_token, {
        type: 'booking_arrival_timeout',
        title: 'Gofixo — Booking cancelled',
        body: row.service_type === 'services'
          ? 'The partner arrived, but the service PIN was not verified within 15 minutes. Your reserved wallet amount has been released.'
          : 'The partner arrived, but the ride PIN was not verified within 15 minutes. The booking was cancelled.',
        booking_id: row.id,
      });
      if (sent && sent.expired) {
        await pool.query(
          'UPDATE customers SET fcm_token = NULL WHERE id = $1 AND fcm_token = $2',
          [row.customer_id, row.fcm_token]
        );
      }
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
const waitingExpiryTimer = setInterval(() => {
  expireWaitingBookings().catch((err) => console.error('[Gofixo waiting policy] Expiry sweep failed:', err.message));
}, 15000);
if (typeof waitingExpiryTimer.unref === 'function') waitingExpiryTimer.unref();

// Unaccepted requests expire 15 minutes after they are offered. This sweep runs
// on the backend (not on a phone), locks rows across server instances, and
// releases any reserved home-service wallet amount exactly once.
async function expireUnacceptedBookings() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expired = await client.query(
      `SELECT b.id, b.customer_id, b.service_type, b.fare_amount, c.fcm_token
         FROM bookings b
         LEFT JOIN customers c ON c.id = b.customer_id
        WHERE b.status = 'requested'
          AND COALESCE(b.offered_at, b.created_at) <= NOW() - INTERVAL '15 minutes'
        ORDER BY COALESCE(b.offered_at, b.created_at)
        LIMIT 100
        FOR UPDATE OF b SKIP LOCKED`
    );
    for (const row of expired.rows) {
      if (row.service_type === 'services') {
        await releaseServiceWallet(client, row.id, row.customer_id, Number(row.fare_amount), 'partner_response_timeout');
      }
      await client.query(
        `UPDATE bookings
            SET status = 'no_provider', offered_at = NULL, start_pin = NULL
          WHERE id = $1 AND status = 'requested'`,
        [row.id]
      );
    }
    await client.query('COMMIT');
    for (const row of expired.rows) {
      if (!row.fcm_token) continue;
      const sent = await sendCustomerFcm(row.fcm_token, {
        type: 'booking_expired',
        title: 'Gofixo — Request expired',
        body: 'No partner accepted your request within 15 minutes. Any reserved service-wallet amount has been released.',
        booking_id: row.id,
      });
      if (sent && sent.expired) {
        await pool.query('UPDATE customers SET fcm_token = NULL WHERE id = $1 AND fcm_token = $2', [row.customer_id, row.fcm_token]);
      }
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
const unacceptedExpiryTimer = setInterval(() => {
  expireUnacceptedBookings().catch((err) => console.error('[Gofixo booking policy] 15-minute request expiry failed:', err.message));
}, 15000);
if (typeof unacceptedExpiryTimer.unref === 'function') unacceptedExpiryTimer.unref();

// List all bookings (admin panel only — contains customer phone numbers and PINs)
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT b.*, sp.name AS provider_name, sp.generated_id AS provider_generated_id, sp.phone AS provider_phone,
              c.name AS customer_name, c.phone AS customer_phone,
              c.profile_photo_url AS customer_profile_photo_url,
              (SELECT pd.id FROM provider_documents pd WHERE pd.provider_id = sp.id AND pd.doc_type = 'profile_photo' ORDER BY pd.uploaded_at DESC, pd.id DESC LIMIT 1) AS provider_profile_photo_document_id,
              (SELECT pd.file_url FROM provider_documents pd WHERE pd.provider_id = sp.id AND pd.doc_type = 'profile_photo' ORDER BY pd.uploaded_at DESC, pd.id DESC LIMIT 1) AS provider_profile_photo_url
       FROM bookings b
       LEFT JOIN service_providers sp ON b.provider_id = sp.id
       LEFT JOIN customers c ON b.customer_id = c.id
       ORDER BY b.created_at DESC LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// A logged-in customer's own bookings (includes their own start_pin)
router.get('/mine', requireAuth(['customer']), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT b.*,
              CASE WHEN b.status IN ('accepted', 'arrived', 'ongoing', 'completed') THEN sp.name END AS provider_name,
              CASE WHEN b.status IN ('accepted', 'arrived', 'ongoing', 'completed') THEN sp.generated_id END AS provider_generated_id,
              CASE WHEN b.status IN ('accepted', 'arrived', 'ongoing', 'completed') THEN sp.phone END AS provider_phone,
              CASE WHEN b.status IN ('accepted', 'arrived', 'ongoing', 'completed') THEN (SELECT pd.file_url FROM provider_documents pd WHERE pd.provider_id = sp.id AND pd.doc_type = 'profile_photo' ORDER BY pd.uploaded_at DESC, pd.id DESC LIMIT 1) END AS provider_profile_photo_url,
              CASE WHEN b.status IN ('accepted', 'arrived', 'ongoing') THEN sp.current_lat END AS provider_lat,
              CASE WHEN b.status IN ('accepted', 'arrived', 'ongoing') THEN sp.current_lng END AS provider_lng,
              sq.service_quote_id, sq.service_quote_status, sq.service_quote_description,
              sq.service_quote_labour_amount, sq.service_quote_visit_fee_credit_amount,
              sq.service_quote_service_amount, sq.service_quote_materials_amount,
              sq.service_quote_total_amount, sq.service_quote_materials
       FROM bookings b
       LEFT JOIN service_providers sp ON b.provider_id = sp.id
       LEFT JOIN LATERAL (
         SELECT id AS service_quote_id, status AS service_quote_status, description AS service_quote_description,
                labour_amount AS service_quote_labour_amount, visit_fee_credit_amount AS service_quote_visit_fee_credit_amount,
                service_amount AS service_quote_service_amount, materials_amount AS service_quote_materials_amount,
                total_amount AS service_quote_total_amount, materials AS service_quote_materials
         FROM service_job_quotes WHERE booking_id = b.id ORDER BY id DESC LIMIT 1
       ) sq ON true
       WHERE b.customer_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// A logged-in provider's own bookings — start_pin is deliberately NOT included:
// the provider has to get it from the customer in person.
router.get('/mine/provider', requireAuth(['provider']), async (req, res, next) => {
  try {
    await ensureWaitingSchema();
    const result = await pool.query(
      `SELECT b.id, b.service_type, b.service_category, b.service_description, b.customer_id, b.provider_id, b.pickup_location, b.drop_or_service_address,
              b.fare_amount, b.route_distance_km, b.duration_minutes, b.status, b.payment_confirmed_by_provider,
              b.arrived_at, b.waiting_fee_amount, b.waiting_fee_status,
              b.created_at, b.completed_at, b.pickup_lat, b.pickup_lng, b.drop_lat, b.drop_lng, b.offered_at,
              sq.service_quote_id, sq.service_quote_status, sq.service_quote_description,
              sq.service_quote_labour_amount, sq.service_quote_materials_amount,
              sq.service_quote_total_amount, sq.service_quote_materials,
              c.name AS customer_name,
              CASE WHEN b.status IN ('accepted', 'arrived', 'ongoing', 'completed') THEN c.phone END AS customer_phone,
              CASE WHEN b.status IN ('accepted', 'arrived', 'ongoing', 'completed') THEN c.profile_photo_url END AS customer_profile_photo_url
       FROM bookings b
       LEFT JOIN customers c ON b.customer_id = c.id
       LEFT JOIN LATERAL (
         SELECT id AS service_quote_id, status AS service_quote_status, description AS service_quote_description,
                labour_amount AS service_quote_labour_amount, materials_amount AS service_quote_materials_amount,
                total_amount AS service_quote_total_amount, materials AS service_quote_materials
         FROM service_job_quotes WHERE booking_id = b.id ORDER BY id DESC LIMIT 1
       ) sq ON true
       LEFT JOIN service_providers target_sp ON target_sp.id = $1
       WHERE (
         b.provider_id = $1
         OR (
           b.status = 'requested'
           AND b.provider_id IS NULL
           AND target_sp.type = b.provider_type
           AND EXISTS (
             SELECT 1 FROM provider_skills ps
             WHERE ps.provider_id = target_sp.id
               AND ps.skill_key = CASE WHEN b.service_type = 'ride' THEN b.provider_type ELSE b.service_category END
               AND ps.service_type = b.service_type
               AND ps.kyc_status = 'approved'
               AND ps.is_available = true
           )
           AND target_sp.is_available = true
           AND target_sp.kyc_status = 'approved'
           AND target_sp.current_lat IS NOT NULL
           AND target_sp.current_lng IS NOT NULL
           AND target_sp.location_updated_at >= NOW() - INTERVAL '3 minutes'
           AND NOT (target_sp.id = ANY(COALESCE(b.declined_providers, '{}')))
           AND NOT EXISTS (
             SELECT 1 FROM bookings active_b
             WHERE active_b.provider_id = target_sp.id
               AND active_b.status IN ('accepted', 'arrived', 'ongoing')
           )
           AND (b.service_type = 'services' OR EXISTS (
             SELECT 1 FROM provider_subscriptions ps
             WHERE ps.provider_id = target_sp.id
               AND ps.status = 'active'
               AND ps.expiry_date > NOW()
           ))
           AND (6371 * acos(
               LEAST(1, GREATEST(-1,
                 cos(radians(CASE WHEN b.service_type = 'services' THEN COALESCE(b.drop_lat, b.pickup_lat) ELSE b.pickup_lat END)) * cos(radians(target_sp.current_lat)) *
                 cos(radians(target_sp.current_lng) - radians(CASE WHEN b.service_type = 'services' THEN COALESCE(b.drop_lng, b.pickup_lng) ELSE b.pickup_lng END)) +
                 sin(radians(CASE WHEN b.service_type = 'services' THEN COALESCE(b.drop_lat, b.pickup_lat) ELSE b.pickup_lat END)) * sin(radians(target_sp.current_lat))
               ))
             )) <= 10
         )
       )
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Create a booking (ride or home service) — customer must be logged in.
// The request is offered to the NEAREST on-duty, KYC-approved provider of the requested type
// (their app buzzes). If they decline or don't respond in time, it moves to the next nearest.
router.post('/', requireAuth(['customer']), async (req, res, next) => {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const {
      service_type,
      provider_type,
      pickup_location,
      drop_or_service_address,
      pickup_lat,
      pickup_lng,
      drop_lat,
      drop_lng,
      estimated_fare,
      route_distance_km,
      service_category: rawServiceCategory,
      service_description: rawServiceDescription,
    } = req.body;
    const customer_id = req.user.id;

    if (!service_type || !provider_type) {
      return res.status(400).json({ error: 'service_type and provider_type are required' });
    }
    if (!SERVICE_TYPES.has(service_type)) {
      return res.status(400).json({ error: 'Invalid service_type' });
    }
    if (!PROVIDER_TYPES.has(provider_type)) {
      return res.status(400).json({ error: 'Invalid provider_type' });
    }
    if (service_type === 'ride' && !['bike', 'auto', 'car'].includes(provider_type)) {
      return res.status(400).json({ error: 'Ride bookings require a bike, auto or car provider' });
    }
    if (service_type === 'services' && !['general_worker', 'skilled_worker'].includes(provider_type)) {
      return res.status(400).json({ error: 'Home services require a worker provider' });
    }

    const serviceCategory = service_type === 'services'
      ? normalizeServiceCategory(rawServiceCategory)
      : null;
    const serviceDescription = service_type === 'services'
      ? String(rawServiceDescription ?? '').trim().slice(0, 500)
      : null;
    if (service_type === 'services' && !serviceCategory) {
      return res.status(400).json({ error: 'service_category is required for home services' });
    }
    if (service_type === 'services' && serviceCategory === 'other'
      && String(rawServiceCategory || '').trim().toLowerCase() !== 'other') {
      return res.status(400).json({ error: 'Unknown home-service category. Please select a service from the catalog.' });
    }
    if (service_type === 'services' && !serviceDescription) {
      return res.status(400).json({ error: 'service_description is required for home services' });
    }
    const pickupLatitude = Number(pickup_lat);
    const pickupLongitude = Number(pickup_lng);
    const destinationLatitude = drop_lat === undefined || drop_lat === null || drop_lat === '' ? null : Number(drop_lat);
    const destinationLongitude = drop_lng === undefined || drop_lng === null || drop_lng === '' ? null : Number(drop_lng);
    if (!Number.isFinite(pickupLatitude) || !Number.isFinite(pickupLongitude)) {
      return res.status(400).json({ error: 'pickup_lat and pickup_lng must be valid numbers' });
    }
    if (pickupLatitude < -90 || pickupLatitude > 90 || pickupLongitude < -180 || pickupLongitude > 180) {
      return res.status(400).json({ error: 'pickup coordinates are out of range' });
    }
    if (destinationLatitude !== null || destinationLongitude !== null) {
      if (!Number.isFinite(destinationLatitude) || !Number.isFinite(destinationLongitude)
        || destinationLatitude < -90 || destinationLatitude > 90
        || destinationLongitude < -180 || destinationLongitude > 180) {
        return res.status(400).json({ error: 'drop_lat and drop_lng must be valid coordinates when provided' });
      }
    }
    if (service_type === 'ride' && (destinationLatitude === null || destinationLongitude === null)) {
      return res.status(400).json({ error: 'drop_lat and drop_lng are required for a ride' });
    }

    // Client distance and fare are hints only; server pricing uses a fresh Google Routes result.
    // Ride matching uses pickup; home-service matching uses the service address.
    const matchingLatitude = service_type === 'services' && destinationLatitude !== null ? destinationLatitude : pickupLatitude;
    const matchingLongitude = service_type === 'services' && destinationLongitude !== null ? destinationLongitude : pickupLongitude;
    let calculatedFare = null;

    if (service_type === 'services') {
      // The selected category, worker type, visibility and display base fare are
      // authoritative on the server. Never trust a client-supplied fare or let a
      // stale app book a category that an admin has disabled.
      try {
        const catalogResult = await pool.query(
          `SELECT provider_type, base_fare, is_active
             FROM service_catalog
            WHERE category_key = $1`,
          [serviceCategory]
        );
        const bookingPolicy = resolveServiceCatalogBooking(catalogResult.rows[0], provider_type);
        if (bookingPolicy.error) {
          const status = !catalogResult.rows[0] || catalogResult.rows[0].is_active !== true
            ? 409
            : catalogResult.rows[0].provider_type !== provider_type ? 400 : 503;
          return res.status(status).json({ error: bookingPolicy.error });
        }
        calculatedFare = bookingPolicy.baseFare;
      } catch (err) {
        // Rolling deployments may briefly run the old backend before migration 016.
        // Fall back only when the table is genuinely absent, never on DB outages.
        if (err.code !== '42P01') throw err;
        calculatedFare = getServiceBaseFare(serviceCategory);
      }
    }

    let routeDistance = null;
    if (service_type === 'ride') {
      routeDistance = await getAuthoritativeRideDistanceKm(
        pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude
      );
      if (!Number.isFinite(routeDistance) || routeDistance <= 0 || routeDistance > 1000) {
        return res.status(400).json({ error: 'The verified ride distance is outside the supported range' });
      }
      calculatedFare = calculateRideFare(provider_type, routeDistance);
    }

    await client.query('BEGIN');
    inTransaction = true;

    // Serialize booking creation for this customer so two simultaneous taps cannot
    // both pass the active-booking check.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`gofixo-customer-booking:${customer_id}`]
    );

    const open = await client.query(
      `SELECT id FROM bookings
       WHERE customer_id = $1 AND status IN ('requested', 'accepted', 'arrived', 'ongoing')
       LIMIT 1
       FOR UPDATE`,
      [customer_id]
    );
    if (open.rows.length > 0) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(409).json({ error: 'You already have an active booking' });
    }

    // Confirm that at least one eligible provider exists.
    // Do not lock provider rows here: provider acceptance has its own atomic
    // checks, and locking every nearby provider can cause false "no provider"
    // results when another booking is being accepted concurrently.
    const nearby = await client.query(
      `SELECT 1
       FROM service_providers sp
       WHERE sp.type = $1
         AND EXISTS (
           SELECT 1 FROM provider_skills skill
           WHERE skill.provider_id = sp.id
             AND skill.skill_key = CASE WHEN $5 = 'ride' THEN $1 ELSE $4 END
             AND skill.service_type = $5
             AND skill.kyc_status = 'approved'
             AND skill.is_available = true
         )
         AND sp.is_available = true
         AND sp.kyc_status = 'approved'
         AND sp.current_lat IS NOT NULL AND sp.current_lng IS NOT NULL
         AND sp.location_updated_at >= NOW() - INTERVAL '3 minutes'
         AND ($5 <> 'ride' OR EXISTS (
           SELECT 1 FROM provider_subscriptions ps
           WHERE ps.provider_id = sp.id
             AND ps.status = 'active'
             AND ps.expiry_date > NOW()
         ))
         AND (6371 * acos(
           LEAST(1, GREATEST(-1,
             cos(radians($2)) * cos(radians(sp.current_lat)) *
             cos(radians(sp.current_lng) - radians($3)) +
             sin(radians($2)) * sin(radians(sp.current_lat))
           ))
         )) <= 10
       LIMIT 1`,
      [provider_type, matchingLatitude, matchingLongitude, serviceCategory, service_type]
    );
    if (nearby.rows.length === 0) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(404).json({ error: 'No available provider found within 10 km. Try again shortly.' });
    }

    const result = await client.query(
      `INSERT INTO bookings (
         service_type, provider_type, service_category, service_description, customer_id, provider_id,
         pickup_location, drop_or_service_address, pickup_lat, pickup_lng, drop_lat, drop_lng, route_distance_km, fare_amount,
         start_pin, status, offered_at, declined_providers
       )
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'requested', NOW(), '{}')
       RETURNING *`,
      [
        service_type, provider_type, serviceCategory, serviceDescription, customer_id,
        pickup_location, drop_or_service_address, pickupLatitude, pickupLongitude,
        destinationLatitude, destinationLongitude, routeDistance, calculatedFare, generatePin()
      ]
    );

    if (service_type === 'services') {
      const reserved = await reserveServiceWallet(client, customer_id, result.rows[0].id, Number(calculatedFare));
      if (!reserved) {
        await client.query('ROLLBACK');
        inTransaction = false;
        return res.status(402).json({
          error: 'Insufficient Gofixo Wallet balance. Add money to your wallet before booking a home service.'
        });
      }
    }

    await client.query('COMMIT');
    inTransaction = false;

    // Send Web Push and FCM alerts after the booking is committed. FCM reaches
    // partner phones when the Flutter app is backgrounded or the screen is locked.
    pool.query(
      `SELECT p.id AS provider_id, p.fcm_token, pps.endpoint, pps.p256dh, pps.auth
       FROM service_providers p
       LEFT JOIN provider_push_subscriptions pps ON pps.provider_id = p.id
       WHERE p.type = $1
         AND EXISTS (
           SELECT 1 FROM provider_skills skill
           WHERE skill.provider_id = p.id
             AND skill.skill_key = CASE WHEN $6 = 'ride' THEN $1 ELSE $4 END
             AND skill.service_type = $6
             AND skill.kyc_status = 'approved'
             AND skill.is_available = true
         )
         AND p.is_available = true
         AND p.kyc_status = 'approved'
         AND p.current_lat IS NOT NULL AND p.current_lng IS NOT NULL
         AND p.location_updated_at >= NOW() - INTERVAL '3 minutes'
         AND (pps.endpoint IS NOT NULL OR p.fcm_token IS NOT NULL)
         AND ($6 <> 'ride' OR EXISTS (
           SELECT 1 FROM provider_subscriptions ps
           WHERE ps.provider_id = p.id
             AND ps.status = 'active'
             AND ps.expiry_date > NOW()
         ))
         AND NOT EXISTS (
           SELECT 1 FROM bookings active_b
           WHERE active_b.provider_id = p.id
             AND active_b.status IN ('accepted', 'arrived', 'ongoing')
         )
         AND NOT EXISTS (
           SELECT 1 FROM bookings requested_b
           WHERE requested_b.id = $5
             AND p.id = ANY(COALESCE(requested_b.declined_providers, '{}'))
         )
         AND (6371 * acos(
           LEAST(1, GREATEST(-1,
             cos(radians($2)) * cos(radians(p.current_lat)) *
             cos(radians(p.current_lng) - radians($3)) +
             sin(radians($2)) * sin(radians(p.current_lat))
           ))
         )) <= 10)`,
      [provider_type, matchingLatitude, matchingLongitude, serviceCategory, result.rows[0].id, service_type]
    ).then(async (pushRows) => {
      for (const row of pushRows.rows) {
        const payload = {
          title: 'Gofixo — New service request',
          body: `${service_type === 'services' ? 'Service address' : 'Pickup'}: ${service_type === 'services' ? (drop_or_service_address || pickup_location || 'Customer location') : (pickup_location || 'Customer location')}`,
          tag: `gofixo-booking-${result.rows[0].id}`,
          booking_id: result.rows[0].id,
          url: '/?provider=request'
        };
        if (row.fcm_token) {
          const fcmResult = await sendProviderFcm(row.fcm_token, payload);
          if (fcmResult && fcmResult.expired) {
            await pool.query('UPDATE service_providers SET fcm_token = NULL WHERE id = $1 AND fcm_token = $2', [row.provider_id, row.fcm_token]);
          }
        }
        if (row.endpoint) {
          const webResult = await sendProviderPush(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            payload
          );
          if (webResult && webResult.expired) {
            await pool.query(
              'DELETE FROM provider_push_subscriptions WHERE provider_id = $1 AND endpoint = $2',
              [row.provider_id, row.endpoint]
            );
          }
        }
      }
    })

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Customer cancels before the ride/job has started.
// The booking row is locked so accept/decline/timeout cannot race the cancellation.
router.post('/:id/cancel', requireAuth(['customer']), async (req, res, next) => {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    inTransaction = true;

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`gofixo-customer-booking:${req.user.id}`]
    );

    const booking = await client.query(
      `SELECT id, customer_id, provider_id, service_type, fare_amount, status
       FROM bookings
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    if (booking.rows.length === 0) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(404).json({ error: 'Booking not found' });
    }

    const current = booking.rows[0];
    if (current.customer_id !== req.user.id) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(403).json({ error: 'This booking does not belong to you' });
    }
    if (!['requested', 'accepted'].includes(current.status)) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(409).json({ error: 'This booking can no longer be cancelled' });
    }

    await client.query(
      `UPDATE bookings
       SET status = 'cancelled', offered_at = NULL
       WHERE id = $1`,
      [id]
    );

    if (current.service_type === 'services') {
      await releaseServiceWallet(client, id, req.user.id, Number(current.fare_amount), 'customer_cancelled');
    }

    if (current.provider_id) {
      const eligibility = await client.query(
        `SELECT 1
         FROM service_providers sp
         WHERE sp.id = $1
           AND sp.kyc_status = 'approved'
           AND sp.current_lat IS NOT NULL
           AND sp.current_lng IS NOT NULL
           AND sp.location_updated_at >= NOW() - INTERVAL '3 minutes'
           AND EXISTS (
             SELECT 1 FROM provider_skills skill
              WHERE skill.provider_id = sp.id
                AND skill.kyc_status = 'approved'
                AND skill.is_available = true
                AND skill.service_type = CASE WHEN sp.type IN ('bike','auto','car') THEN 'ride' ELSE 'services' END
                AND (skill.service_type <> 'ride' OR skill.skill_key = sp.type)
           )
           AND NOT EXISTS (
             SELECT 1 FROM bookings b
             WHERE b.provider_id = sp.id
               AND b.status IN ('requested', 'accepted', 'arrived', 'ongoing')
               AND b.id <> $2
           )
           AND (sp.type NOT IN ('bike','auto','car') OR EXISTS (
             SELECT 1 FROM provider_subscriptions ps
             WHERE ps.provider_id = sp.id
               AND ps.status = 'active'
               AND ps.expiry_date > NOW()
           ))`,
        [current.provider_id, id]
      );
      await client.query(
        'UPDATE service_providers SET is_available = $1 WHERE id = $2',
        [eligibility.rows.length > 0, current.provider_id]
      );
    }

    await client.query('COMMIT');
    inTransaction = false;

    // Stop the pending request alert on every partner phone/browser that could
    // have received the offer. This runs only after the cancellation is committed.
    pool.query(
      `SELECT p.id AS provider_id, p.fcm_token, pps.endpoint, pps.p256dh, pps.auth
       FROM bookings b
       JOIN service_providers p ON true
       LEFT JOIN provider_push_subscriptions pps ON pps.provider_id = p.id
       WHERE b.id = $1
         AND p.type = b.provider_type
         AND (p.fcm_token IS NOT NULL OR pps.endpoint IS NOT NULL)
         AND EXISTS (
           SELECT 1 FROM provider_skills skill
           WHERE skill.provider_id = p.id
             AND skill.skill_key = CASE WHEN b.service_type = 'ride' THEN b.provider_type ELSE b.service_category END
             AND skill.service_type = b.service_type
             AND skill.kyc_status = 'approved'
             AND skill.is_available = true
         )
         AND NOT (p.id = ANY(COALESCE(b.declined_providers, '{}')))`,
      [id]
    ).then(async (pushRows) => {
      for (const row of pushRows.rows) {
        const payload = {
          type: 'booking_cancelled',
          title: 'Gofixo — Request cancelled',
          body: 'The customer cancelled this request.',
          tag: `gofixo-booking-${id}`,
          booking_id: id,
          url: '/?provider=request'
        };
        if (row.fcm_token) {
          const fcmResult = await sendProviderFcm(row.fcm_token, payload, { cancelled: true });
          if (fcmResult && fcmResult.expired) {
            await pool.query(
              'UPDATE service_providers SET fcm_token = NULL WHERE id = $1 AND fcm_token = $2',
              [row.provider_id, row.fcm_token]
            );
          }
        }
        if (row.endpoint) {
          const webResult = await sendProviderPush(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            payload
          );
          if (webResult && webResult.expired) {
            await pool.query(
              'DELETE FROM provider_push_subscriptions WHERE provider_id = $1 AND endpoint = $2',
              [row.provider_id, row.endpoint]
            );
          }
        }
      }
    }).catch((pushError) => {
      console.error('Failed to send booking cancellation alerts:', pushError.message);
    });

    res.json({ message: 'Booking cancelled', booking_id: Number(id) });
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});
// Provider may cancel an accepted/arrived booking before the customer PIN starts the job.
router.post('/:id/provider-cancel', requireAuth(['provider']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, customer_id, provider_id, service_type, fare_amount, status
         FROM bookings WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    const current = result.rows[0];
    if (Number(current.provider_id) !== Number(req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This booking does not belong to you' });
    }
    if (!['accepted', 'arrived'].includes(current.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A booking can only be cancelled by the partner before the job starts' });
    }
    if (current.service_type === 'services') {
      await releaseServiceWallet(client, current.id, current.customer_id, Number(current.fare_amount), 'partner_cancelled');
    }
    await client.query(
      `UPDATE bookings
          SET status = 'cancelled', offered_at = NULL, start_pin = NULL,
              waiting_fee_amount = 0, waiting_fee_status = 'not_applicable'
        WHERE id = $1`,
      [current.id]
    );
    const eligible = await client.query(
      `SELECT 1 FROM service_providers sp
        WHERE sp.id = $1 AND sp.kyc_status = 'approved'
          AND sp.location_updated_at >= NOW() - INTERVAL '3 minutes'
          AND EXISTS (
            SELECT 1 FROM provider_skills skill
             WHERE skill.provider_id = sp.id
               AND skill.kyc_status = 'approved'
               AND skill.is_available = true
               AND skill.service_type = CASE WHEN sp.type IN ('bike','auto','car') THEN 'ride' ELSE 'services' END
               AND (skill.service_type <> 'ride' OR skill.skill_key = sp.type)
          )
          AND (sp.type NOT IN ('bike','auto','car') OR EXISTS (SELECT 1 FROM provider_subscriptions ps
                       WHERE ps.provider_id = sp.id AND ps.status = 'active' AND ps.expiry_date > NOW()))
          AND NOT EXISTS (SELECT 1 FROM bookings b
                           WHERE b.provider_id = sp.id AND b.status IN ('accepted','arrived','ongoing') AND b.id <> $2)`,
      [req.user.id, current.id]
    );
    await client.query(
      'UPDATE service_providers SET is_available = $1 WHERE id = $2',
      [eligible.rows.length > 0, req.user.id]
    );
    await client.query('COMMIT');
    pool.query('SELECT fcm_token FROM customers WHERE id = $1', [current.customer_id])
      .then(async (customer) => {
        const token = customer.rows[0]?.fcm_token;
        if (!token) return;
        const sent = await sendCustomerFcm(token, {
          type: 'customer_booking_cancelled',
          title: 'Gofixo — Partner cancelled',
          body: 'Your partner cancelled this booking. You can place a new request.',
          booking_id: current.id,
        });
        if (sent && sent.expired) {
          await pool.query('UPDATE customers SET fcm_token = NULL WHERE id = $1 AND fcm_token = $2', [current.customer_id, token]);
        }
      })
      .catch((pushError) => console.error('Customer cancellation notification failed:', pushError.message));
    return res.json({ message: 'Booking cancelled by partner', booking_id: Number(current.id), status: 'cancelled' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Provider accepts the request that is buzzing on their phone.
// Re-check subscription/KYC and active-booking ownership atomically so an offer
// cannot be accepted after the provider becomes ineligible or gets another job.
router.post('/:id/accept', requireAuth(['provider']), async (req, res, next) => {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`gofixo-provider-booking:${req.user.id}`]
    );

    const result = await client.query(
      `UPDATE bookings b SET provider_id = $2, status = 'accepted', offered_at = NULL
       WHERE b.id = $1
         AND b.status = 'requested'
         AND (b.provider_id IS NULL OR b.provider_id = $2)
         AND NOT ($2 = ANY(COALESCE(b.declined_providers, '{}')))
         AND EXISTS (
           SELECT 1
           FROM service_providers sp
           WHERE sp.id = $2
             AND sp.type = b.provider_type
             AND sp.is_available = true
             AND EXISTS (
               SELECT 1 FROM provider_skills skill
               WHERE skill.provider_id = sp.id
                 AND skill.skill_key = CASE WHEN b.service_type = 'ride' THEN b.provider_type ELSE b.service_category END
                 AND skill.service_type = b.service_type
                 AND skill.kyc_status = 'approved'
                 AND skill.is_available = true
             )
             AND sp.kyc_status = 'approved'
             AND sp.current_lat IS NOT NULL AND sp.current_lng IS NOT NULL
         AND sp.location_updated_at >= NOW() - INTERVAL '3 minutes'
             AND (b.service_type = 'services' OR EXISTS (
               SELECT 1
               FROM provider_subscriptions ps
               WHERE ps.provider_id = sp.id
                 AND ps.status = 'active'
                 AND ps.expiry_date > NOW()
             ))
             AND (6371 * acos(
               LEAST(1, GREATEST(-1,
                 cos(radians(CASE WHEN b.service_type = 'services' THEN COALESCE(b.drop_lat, b.pickup_lat) ELSE b.pickup_lat END)) * cos(radians(sp.current_lat)) *
                 cos(radians(sp.current_lng) - radians(CASE WHEN b.service_type = 'services' THEN COALESCE(b.drop_lng, b.pickup_lng) ELSE b.pickup_lng END)) +
                 sin(radians(CASE WHEN b.service_type = 'services' THEN COALESCE(b.drop_lat, b.pickup_lat) ELSE b.pickup_lat END)) * sin(radians(sp.current_lat))
               ))
             )) <= 10
         )
         AND NOT EXISTS (
           SELECT 1
           FROM bookings active_b
           WHERE active_b.provider_id = $2
             AND active_b.status IN ('accepted', 'arrived', 'ongoing')
             AND active_b.id <> b.id
         )
       RETURNING b.id, b.service_type, b.customer_id, b.provider_id, b.pickup_location,
                 b.drop_or_service_address, b.status, b.pickup_lat, b.pickup_lng, b.drop_lat, b.drop_lng, b.created_at`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(409).json({
        error: 'This request is no longer available or your provider account is not currently eligible'
      });
    }

    // The winner is busy for this booking; all other broadcast recipients stay online.
    await client.query(
      'UPDATE service_providers SET is_available = false WHERE id = $1',
      [req.user.id]
    );

    await client.query('COMMIT');
    inTransaction = false;
    const acceptedBooking = result.rows[0];

    // Cancel this request's alert for all other eligible providers, for both
    // browser subscriptions and native FCM tokens. Keep other partners online.
    pool.query(
      `SELECT p.id AS provider_id, p.fcm_token, pps.endpoint, pps.p256dh, pps.auth
       FROM service_providers p
       LEFT JOIN provider_push_subscriptions pps ON pps.provider_id = p.id
       JOIN bookings b ON b.id = $1
       WHERE p.id <> $2
         AND p.type = b.provider_type
         AND EXISTS (
           SELECT 1 FROM provider_skills skill
           WHERE skill.provider_id = p.id
             AND skill.skill_key = CASE WHEN b.service_type = 'ride' THEN b.provider_type ELSE b.service_category END
             AND skill.service_type = b.service_type
             AND skill.kyc_status = 'approved'
             AND skill.is_available = true
         )
         AND (pps.endpoint IS NOT NULL OR p.fcm_token IS NOT NULL)
         AND NOT (p.id = ANY(COALESCE(b.declined_providers, '{}')))`,
      [acceptedBooking.id, req.user.id]
    ).then(async (pushRows) => {
      for (const row of pushRows.rows) {
        const payload = {
          type: 'booking_cancelled',
          title: 'Gofixo — Request taken',
          body: 'This request was accepted by another partner.',
          tag: `gofixo-booking-${acceptedBooking.id}`,
          booking_id: acceptedBooking.id,
          url: '/?provider=request'
        };
        if (row.fcm_token) {
          const fcmResult = await sendProviderFcm(row.fcm_token, payload, { cancelled: true });
          if (fcmResult && fcmResult.expired) {
            await pool.query('UPDATE service_providers SET fcm_token = NULL WHERE id = $1 AND fcm_token = $2', [row.provider_id, row.fcm_token]);
          }
        }
        if (row.endpoint) {
          const webResult = await sendProviderPush(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            payload
          );
          if (webResult && webResult.expired) {
            await pool.query(
              'DELETE FROM provider_push_subscriptions WHERE provider_id = $1 AND endpoint = $2',
              [row.provider_id, row.endpoint]
            );
          }
        }
      }
    })

    res.json(acceptedBooking);
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Provider marks the customer pickup as reached. This is server-authoritative so the ride
// can show a real "arrived" state before the one-time start PIN is entered.
router.post('/:id/arrived', requireAuth(['provider']), async (req, res, next) => {
  try {
    await ensureWaitingSchema();
    const result = await pool.query(
      `UPDATE bookings
       SET status = 'arrived',
           arrived_at = NOW(),
           waiting_fee_amount = 0,
           waiting_fee_status = 'accruing'
       WHERE id = $1
         AND provider_id = $2
         AND status = 'accepted'
       RETURNING id, service_type, customer_id, provider_id, pickup_location, drop_or_service_address,
                 pickup_lat, pickup_lng, drop_lat, drop_lng, fare_amount, status, created_at,
                 arrived_at, waiting_fee_amount, waiting_fee_status`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Booking must be accepted before marking arrival' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Partner confirms cash collection of a PIN-waiting fee after the 15-minute auto-cancel.
router.post('/:id/confirm-waiting-fee', requireAuth(['provider']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await ensureWaitingSchema();
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE bookings
          SET waiting_fee_status = 'paid'
        WHERE id = $1
          AND provider_id = $2
          AND status = 'cancelled'
          AND waiting_fee_status = 'due'
          AND waiting_fee_amount > 0
        RETURNING id, provider_id, waiting_fee_amount, waiting_fee_status`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No unpaid waiting fee is available for this booking.' });
    }
    const fee = Number(result.rows[0].waiting_fee_amount);
    await client.query(
      `INSERT INTO earnings_log (booking_id, provider_id, amount)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [req.params.id, req.user.id, fee]
    );
    await client.query('COMMIT');
    return res.json({ booking_id: Number(req.params.id), waiting_fee_amount: fee, waiting_fee_status: 'paid' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Provider declines — stays on duty; the request goes to the next nearest provider.
router.post('/:id/decline', requireAuth(['provider']), async (req, res, next) => {
  const client = await pool.connect();
  let inTransaction = false;
  let closedBooking = null;
  let walletReservationReleased = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;

    // Serialize declines for this booking so the final eligible provider cannot
    // race another decline and leave a request open or its wallet reserve locked.
    const bookingResult = await client.query(
      `SELECT id, customer_id, service_type, fare_amount, status, provider_id,
              declined_providers
         FROM bookings
        WHERE id = $1
        FOR UPDATE`,
      [req.params.id]
    );
    if (!bookingResult.rows.length || bookingResult.rows[0].status !== 'requested') {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(409).json({ error: 'This request is no longer available' });
    }
    const booking = bookingResult.rows[0];
    if (booking.provider_id != null && Number(booking.provider_id) !== Number(req.user.id)) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(409).json({ error: 'This request is no longer available' });
    }
    // A provider may decline only a request they are actually eligible to receive.
    // Without this check, any authenticated provider who guesses a booking ID could
    // mutate another customer's request or prematurely exhaust its provider pool.
    const eligibleToDecline = await client.query(
      `SELECT 1
         FROM bookings b
         JOIN service_providers sp ON sp.id = $2
        WHERE b.id = $1
          AND b.status = 'requested'
          AND (b.provider_id IS NULL OR b.provider_id = sp.id)
          AND sp.type = b.provider_type
          AND sp.is_available = true
          AND sp.kyc_status = 'approved'
          AND sp.current_lat IS NOT NULL
          AND sp.current_lng IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM provider_skills skill
             WHERE skill.provider_id = sp.id
               AND skill.skill_key = CASE WHEN b.service_type = 'ride' THEN b.provider_type ELSE b.service_category END
               AND skill.service_type = b.service_type
               AND skill.kyc_status = 'approved'
               AND skill.is_available = true
          )
          AND (b.service_type = 'services' OR EXISTS (
            SELECT 1 FROM provider_subscriptions ps
             WHERE ps.provider_id = sp.id
               AND ps.status = 'active'
               AND ps.expiry_date > NOW()
          ))
          AND NOT EXISTS (
            SELECT 1 FROM bookings active_b
             WHERE active_b.provider_id = sp.id
               AND active_b.status IN ('accepted', 'arrived', 'ongoing')
               AND active_b.id <> b.id
          )
          AND (6371 * acos(
            LEAST(1, GREATEST(-1,
              cos(radians(CASE WHEN b.service_type = 'services' THEN COALESCE(b.drop_lat, b.pickup_lat) ELSE b.pickup_lat END)) * cos(radians(sp.current_lat)) *
              cos(radians(sp.current_lng) - radians(CASE WHEN b.service_type = 'services' THEN COALESCE(b.drop_lng, b.pickup_lng) ELSE b.pickup_lng END)) +
              sin(radians(CASE WHEN b.service_type = 'services' THEN COALESCE(b.drop_lat, b.pickup_lat) ELSE b.pickup_lat END)) * sin(radians(sp.current_lat))
            ))
          )) <= 10
        LIMIT 1`,
      [req.params.id, req.user.id]
    );
    if (eligibleToDecline.rows.length === 0) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(403).json({ error: 'You are not eligible to decline this request' });
    }

    const declined = (booking.declined_providers || []).map(Number);
    if (declined.includes(Number(req.user.id))) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(409).json({ error: 'This request is no longer available' });
    }

    await client.query(
      `UPDATE bookings
          SET declined_providers = array_append(COALESCE(declined_providers, '{}'), $2)
        WHERE id = $1 AND status = 'requested'`,
      [req.params.id, req.user.id]
    );

    // Keep everyone else online. If nobody eligible within 10 km remains,
    // close the request and release any home-service wallet reservation.
    const remaining = await client.query(
      `SELECT 1
         FROM bookings b
         JOIN service_providers sp ON true
        WHERE b.id = $1
          AND b.status = 'requested'
          AND b.provider_id IS NULL
          AND sp.type = b.provider_type
          AND EXISTS (
            SELECT 1 FROM provider_skills skill
             WHERE skill.provider_id = sp.id
               AND skill.skill_key = CASE WHEN b.service_type = 'ride' THEN b.provider_type ELSE b.service_category END
               AND skill.service_type = b.service_type
               AND skill.kyc_status = 'approved'
               AND skill.is_available = true
          )
          AND sp.is_available = true
          AND sp.kyc_status = 'approved'
          AND sp.current_lat IS NOT NULL AND sp.current_lng IS NOT NULL
         AND sp.location_updated_at >= NOW() - INTERVAL '3 minutes'
          AND NOT (sp.id = ANY(COALESCE(b.declined_providers, '{}')))
          AND (b.service_type = 'services' OR EXISTS (
            SELECT 1 FROM provider_subscriptions ps
             WHERE ps.provider_id = sp.id
               AND ps.status = 'active'
               AND ps.expiry_date > NOW()
          ))
          AND (6371 * acos(
            LEAST(1, GREATEST(-1,
              cos(radians(CASE WHEN b.service_type = 'services' THEN COALESCE(b.drop_lat, b.pickup_lat) ELSE b.pickup_lat END)) * cos(radians(sp.current_lat)) *
              cos(radians(sp.current_lng) - radians(CASE WHEN b.service_type = 'services' THEN COALESCE(b.drop_lng, b.pickup_lng) ELSE b.pickup_lng END)) +
              sin(radians(CASE WHEN b.service_type = 'services' THEN COALESCE(b.drop_lat, b.pickup_lat) ELSE b.pickup_lat END)) * sin(radians(sp.current_lat))
            ))
          )) <= 10
        LIMIT 1`,
      [req.params.id]
    );

    if (remaining.rows.length === 0) {
      if (booking.service_type === 'services') {
        walletReservationReleased = await releaseServiceWallet(
          client,
          booking.id,
          booking.customer_id,
          Number(booking.fare_amount),
          'no_eligible_provider'
        );
      }
      await client.query(
        `UPDATE bookings
            SET status = 'no_provider', offered_at = NULL, start_pin = NULL
          WHERE id = $1 AND status = 'requested'`,
        [req.params.id]
      );
      closedBooking = booking;
    }

    await client.query('COMMIT');
    inTransaction = false;

    if (closedBooking) {
      pool.query('SELECT fcm_token FROM customers WHERE id = $1', [closedBooking.customer_id])
        .then(async (customer) => {
          const token = customer.rows[0]?.fcm_token;
          if (!token) return;
          const sent = await sendCustomerFcm(token, {
            type: 'booking_expired',
            title: 'Gofixo — No partner available',
            body: 'No eligible partner is available nearby. Any reserved service-wallet amount has been released.',
            booking_id: closedBooking.id,
          });
          if (sent && sent.expired) {
            await pool.query(
              'UPDATE customers SET fcm_token = NULL WHERE id = $1 AND fcm_token = $2',
              [closedBooking.customer_id, token]
            );
          }
        })
        .catch((pushError) => console.error('Failed to notify customer about unavailable booking:', pushError.message));
    }

    return res.json({
      message: 'Request declined',
      booking_status: closedBooking ? 'no_provider' : 'requested',
      wallet_reservation_released: walletReservationReleased,
    });
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Provider starts the ride/job by entering the PIN the customer sees on their dashboard.
// The update is atomic and clears the PIN after success, making it single-use.
router.post('/:id/start', requireAuth(['provider']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pin } = req.body;
    const normalizedPin = String(pin ?? '').trim();
    if (!/^\d{4}$/.test(normalizedPin)) {
      return res.status(400).json({ error: 'pin must be exactly 4 digits' });
    }

    await ensureWaitingSchema();
    const result = await pool.query(
      `UPDATE bookings
       SET status = 'ongoing',
           waiting_fee_amount = CASE
             WHEN status = 'arrived' AND arrived_at IS NOT NULL
               THEN LEAST($4, CEIL(EXTRACT(EPOCH FROM (NOW() - arrived_at)) / 60) * $5)
             ELSE 0
           END,
           waiting_fee_status = CASE
             WHEN status = 'arrived' AND arrived_at IS NOT NULL THEN 'due'
             ELSE 'not_applicable'
           END,
           start_pin = NULL
       WHERE id = $1
         AND provider_id = $2
         AND status IN ('accepted', 'arrived')
         AND start_pin = $3
         AND NOT EXISTS (
           SELECT 1 FROM service_job_quotes pending_quote
            WHERE pending_quote.booking_id = bookings.id
              AND pending_quote.status = 'proposed'
         )
         AND (status <> 'arrived' OR arrived_at > NOW() - ($6 * INTERVAL '1 minute'))
       RETURNING id, service_type, customer_id, provider_id, pickup_location, status, created_at,
                 arrived_at, waiting_fee_amount, waiting_fee_status`,
      [id, req.user.id, normalizedPin, WAITING_RATE_PER_MINUTE * WAITING_LIMIT_MINUTES,
       WAITING_RATE_PER_MINUTE, WAITING_LIMIT_MINUTES]
    );

    if (result.rows.length > 0) {
      return res.json(result.rows[0]);
    }

    const existing = await pool.query(
      'SELECT provider_id, start_pin, status, arrived_at FROM bookings WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    if (existing.rows[0].provider_id !== req.user.id) {
      return res.status(403).json({ error: 'This booking does not belong to you' });
    }
    if (existing.rows[0].status === 'arrived' && existing.rows[0].arrived_at && Date.now() - new Date(existing.rows[0].arrived_at).getTime() >= WAITING_LIMIT_MINUTES * 60000) {
      await expireWaitingBookings();
      return res.status(409).json({ error: 'Waiting limit reached. This ride has been cancelled.' });
    }
    if (existing.rows[0].status !== 'accepted' && existing.rows[0].status !== 'arrived') {
      return res.status(400).json({
        error: existing.rows[0].status === 'requested'
          ? 'Accept the request first'
          : `Booking is already ${existing.rows[0].status}`
      });
    }
    return res.status(401).json({ error: 'Incorrect PIN' });
  } catch (err) {
    next(err);
  }
});

// Customer rates the provider after a completed booking
router.post('/:id/rate', requireAuth(['customer']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;
    if (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
    }
    if (comment !== undefined && comment !== null && (typeof comment !== 'string' || comment.length > 500)) {
      return res.status(400).json({ error: 'comment must be text up to 500 characters' });
    }

    await client.query('BEGIN');

    // Serialize ratings for this booking so two concurrent submissions cannot
    // both pass the duplicate-rating check.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`gofixo-booking-rating:${id}`]
    );

    const booking = await client.query('SELECT customer_id, provider_id, status FROM bookings WHERE id = $1', [id]);
    if (booking.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    if (booking.rows[0].customer_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This booking does not belong to you' });
    }
    if (booking.rows[0].status !== 'completed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Can only rate a completed booking' });
    }

    const already = await client.query(
      `SELECT 1 FROM booking_ratings WHERE booking_id = $1 AND rated_by = 'customer'`,
      [id]
    );
    if (already.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You have already rated this booking' });
    }

    await client.query(
      `INSERT INTO booking_ratings (booking_id, rated_by, rating, comment) VALUES ($1, 'customer', $2, $3)`,
      [id, rating, comment || null]
    );

    // Update the provider's running average rating
    const providerId = booking.rows[0].provider_id;
    const avg = await client.query(
      `SELECT AVG(rating)::numeric(2,1) AS avg_rating FROM booking_ratings br
       JOIN bookings b ON br.booking_id = b.id
       WHERE b.provider_id = $1 AND br.rated_by = 'customer'`,
      [providerId]
    );
    await client.query('UPDATE service_providers SET avg_rating = $1 WHERE id = $2', [avg.rows[0].avg_rating, providerId]);

    await client.query('COMMIT');
    res.status(201).json({ message: 'Rating submitted' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// Provider confirms payment received — this is what unlocks their next booking.
// Only possible once the ride/job was started with the customer's PIN.
router.post('/:id/confirm-payment', requireAuth(['provider']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const paymentMethod = String(req.body?.payment_method || 'cash').trim().toLowerCase();
    const { fare_amount, rating, comment } = req.body;
    const submittedFare = fare_amount === undefined || fare_amount === null || fare_amount === '' ? null : Number(fare_amount);

    if (!['cash', 'wallet'].includes(paymentMethod)) {
      return res.status(400).json({ error: 'Unsupported payment method' });
    }
    if (submittedFare !== null && (!Number.isFinite(submittedFare) || submittedFare <= 0 || submittedFare > 1000000)) {
      return res.status(400).json({ error: 'fare_amount must be a positive amount up to 1000000' });
    }
    if (rating !== undefined && rating !== null && (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5)) {
      return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
    }
    if (comment !== undefined && comment !== null && (typeof comment !== 'string' || comment.length > 500)) {
      return res.status(400).json({ error: 'comment must be a string up to 500 characters' });
    }

    const configuredCommission = Number(process.env.GOFIXO_COMMISSION_PERCENT || 20);
    const commissionPercent = Number.isFinite(configuredCommission)
      ? Math.min(50, Math.max(20, configuredCommission))
      : 20;

    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT b.provider_id, b.customer_id, b.service_type, b.status, b.fare_amount, b.payment_status, b.waiting_fee_amount, b.waiting_fee_status, COALESCE(q.materials_amount, 0) AS approved_material_amount FROM bookings b LEFT JOIN LATERAL (SELECT materials_amount FROM service_job_quotes WHERE booking_id = b.id AND status = 'approved' ORDER BY id DESC LIMIT 1) q ON true WHERE b.id = $1 FOR UPDATE OF b`,
      [id]
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    if (existing.rows[0].provider_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This booking does not belong to you' });
    }
    if (existing.rows[0].status !== 'ongoing') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: existing.rows[0].status === 'completed'
          ? 'Payment is already confirmed'
          : 'Start the ride/job with the customer PIN before confirming payment'
      });
    }

    // Fare is locked when the booking is created. Never allow the provider/client
    // app to rewrite the customer-facing amount at completion.
    const lockedFare = Number(existing.rows[0].fare_amount);
    if (!Number.isFinite(lockedFare) || lockedFare <= 0 || lockedFare > 1000000) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Booking has no valid locked fare' });
    }
    const isService = existing.rows[0].service_type === 'services';
    const waitingFee = !isService && ['due', 'accruing'].includes(existing.rows[0].waiting_fee_status)
      ? Number(Number(existing.rows[0].waiting_fee_amount || 0).toFixed(2)) : 0;
    const approvedMaterialAmount = isService ? Number(existing.rows[0].approved_material_amount || 0) : 0;
    const totalServiceCharge = Number((lockedFare + approvedMaterialAmount).toFixed(2));
    const totalCharge = Number((totalServiceCharge + waitingFee).toFixed(2));
    if (submittedFare !== null && Math.abs(submittedFare - totalCharge) > 0.01) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: waitingFee > 0
        ? 'Total due includes the waiting fee. Refresh the booking and retry.'
        : 'Fare is locked to the upfront booking price' });
    }

    const fare = Number(lockedFare.toFixed(2));
    if (isService && paymentMethod !== 'wallet') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Home-service bookings must be settled from the Gofixo Wallet' });
    }
    if (!isService && paymentMethod !== 'cash') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ride bookings currently use cash settlement' });
    }
    const effectiveCommissionPercent = isService ? commissionPercent : 0;
    const commission = Number((fare * effectiveCommissionPercent / 100).toFixed(2));
    const providerAmount = Number((fare + approvedMaterialAmount + waitingFee - commission).toFixed(2));

    if (isService) {
      const captured = await captureServiceWallet(client, Number(id), existing.rows[0].customer_id, totalServiceCharge);
      if (!captured) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Wallet reservation is missing or does not cover this service amount' });
      }
    }

    const booking = await client.query(
      `UPDATE bookings
       SET status = 'completed',
           payment_confirmed_by_provider = true,
           payment_method = $1,
           payment_status = 'paid',
           commission_amount = $2,
           provider_earning_amount = $3,
           waiting_fee_status = CASE WHEN $7 > 0 THEN 'paid' ELSE waiting_fee_status END,
           completed_at = NOW()
       WHERE id = $5
         AND provider_id = $6
         AND status = 'ongoing'
       RETURNING id, service_type, customer_id, provider_id, pickup_location, fare_amount,
                 payment_method, payment_status, commission_amount, provider_earning_amount,
                 waiting_fee_amount, waiting_fee_status, status, completed_at`,
      [paymentMethod, commission, providerAmount, fare, id, req.user.id, waitingFee]
    );

    if (booking.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Payment confirmation could not be completed' });
    }

    // Exactly one transaction row per completed booking. The unique booking_id
    // constraint prevents duplicate financial records under retries.
    await client.query(
      `INSERT INTO booking_transactions
        (booking_id, customer_id, provider_id, gross_amount, commission_amount, provider_amount, payment_method, status, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', NOW())
       ON CONFLICT (booking_id) DO NOTHING`,
      [id, booking.rows[0].customer_id, req.user.id, totalCharge, commission, providerAmount, paymentMethod]
    );

    // Earnings log records the partner's net earning, not the customer's gross
    // fare. This keeps subscription earning caps aligned with actual partner pay.
    await client.query(
      `INSERT INTO earnings_log (booking_id, provider_id, amount)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [id, req.user.id, providerAmount]
    );

    if (isService) {
      await client.query(
        `INSERT INTO partner_payouts
          (booking_id, provider_id, gross_amount, platform_fee, payout_amount, payout_method, payout_status)
         VALUES ($1,$2,$3,$4,$5,'bank_or_upi','pending')
         ON CONFLICT (booking_id) DO NOTHING`,
        [id, req.user.id, totalServiceCharge, commission, providerAmount]
      );
    }

    // Ride partners use subscription earning caps; Home Services partners
    // use the separate service commission and are not restricted by ride plans.
    let providerAvailable = booking.rows[0].service_type === 'services';
    if (booking.rows[0].service_type === 'ride') {
      await client.query(
        `UPDATE provider_subscriptions
         SET status = 'expired'
         WHERE provider_id = $1 AND status = 'active' AND expiry_date <= NOW()`,
        [req.user.id]
      );
      const sub = await client.query(
        `SELECT ps.id, ps.total_earned_this_cycle, sp.earning_cap AS cap
         FROM provider_subscriptions ps
         JOIN subscription_plans sp ON sp.id = ps.plan_id
         WHERE ps.provider_id = $1 AND ps.status = 'active' AND ps.expiry_date > NOW()
         ORDER BY ps.start_date DESC, ps.id DESC LIMIT 1 FOR UPDATE`,
        [req.user.id]
      );
      providerAvailable = false;
      if (sub.rows.length > 0) {
        const currentEarned = Number(sub.rows[0].total_earned_this_cycle || 0);
        const earningCap = Number(sub.rows[0].cap);
        if (Number.isFinite(earningCap) && earningCap > 0) {
          const newTotal = Number((currentEarned + providerAmount).toFixed(2));
          await client.query(
            `UPDATE provider_subscriptions
             SET total_earned_this_cycle = $1::numeric,
                 status = CASE WHEN $1::numeric >= $2::numeric THEN 'exhausted' ELSE 'active' END
             WHERE id = $3`,
            [newTotal, earningCap, sub.rows[0].id]
          );
          providerAvailable = newTotal < earningCap;
        } else {
          await client.query('UPDATE provider_subscriptions SET status = \'exhausted\' WHERE id = $1', [sub.rows[0].id]);
        }
      }
    }

    const onlineEligibility = await client.query(
      `SELECT 1 FROM service_providers sp
        WHERE sp.id = $1
          AND sp.kyc_status = 'approved'
          AND sp.location_updated_at >= NOW() - INTERVAL '3 minutes'
          AND EXISTS (
            SELECT 1 FROM provider_skills skill
             WHERE skill.provider_id = sp.id
               AND skill.kyc_status = 'approved'
               AND skill.is_available = true
               AND skill.service_type = CASE WHEN sp.type IN ('bike','auto','car') THEN 'ride' ELSE 'services' END
               AND (skill.service_type <> 'ride' OR skill.skill_key = sp.type)
          )
          AND NOT EXISTS (
            SELECT 1 FROM bookings active_b
             WHERE active_b.provider_id = sp.id
               AND active_b.status IN ('accepted', 'arrived', 'ongoing')
          )
          AND (sp.type NOT IN ('bike','auto','car') OR EXISTS (
            SELECT 1 FROM provider_subscriptions ps
             WHERE ps.provider_id = sp.id
               AND ps.status = 'active'
               AND ps.expiry_date > NOW()
          ))`,
      [req.user.id]
    );
    providerAvailable = providerAvailable && onlineEligibility.rows.length > 0;
    await client.query(
      'UPDATE service_providers SET is_available = $1 WHERE id = $2',
      [providerAvailable, req.user.id]
    );

    if (rating) {
      await client.query(
        `INSERT INTO booking_ratings (booking_id, rated_by, rating, comment)
         VALUES ($1, 'provider', $2, $3)
         ON CONFLICT (booking_id, rated_by) DO NOTHING`,
        [id, rating, comment || null]
      );
    }

    await client.query('COMMIT');
    res.json({
      booking: booking.rows[0],
      transaction: {
        gross_amount: fare,
        commission_percent: commissionPercent,
        commission_amount: commission,
        provider_earning_amount: providerAmount,
        payment_method: paymentMethod,
        payment_status: 'paid'
      },
      provider_available: providerAvailable
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
