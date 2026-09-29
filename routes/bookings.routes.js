const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { findNearestProvider, claimNearestProvider, handleDeclineOrTimeout } = require('../services/matching');
const { sendProviderPush } = require('../services/push');

const SERVICE_TYPES = new Set(['ride', 'services']);
const PROVIDER_TYPES = new Set(['bike', 'auto', 'car', 'general_worker', 'skilled_worker']);

function generatePin() {
  return String(crypto.randomInt(1000, 10000)); // cryptographically secure 4-digit PIN
}

// Booking lifecycle:
//   requested  -> offered to the nearest on-duty provider (their app buzzes); they have a short window to respond
//   accepted   -> provider accepted and is on the way; customer's PIN is needed to start
//   ongoing    -> provider entered the correct PIN
//   completed  -> provider confirmed payment
//   no_provider-> everyone nearby declined / missed it

// List all bookings (admin panel only — contains customer phone numbers and PINs)
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT b.*, sp.name AS provider_name, sp.generated_id AS provider_generated_id, sp.phone AS provider_phone,
              c.name AS customer_name, c.phone AS customer_phone
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
              CASE WHEN b.status IN ('accepted', 'ongoing', 'completed') THEN sp.name END AS provider_name,
              CASE WHEN b.status IN ('accepted', 'ongoing', 'completed') THEN sp.generated_id END AS provider_generated_id,
              CASE WHEN b.status IN ('accepted', 'ongoing', 'completed') THEN sp.phone END AS provider_phone,
              CASE WHEN b.status IN ('accepted', 'ongoing') THEN sp.current_lat END AS provider_lat,
              CASE WHEN b.status IN ('accepted', 'ongoing') THEN sp.current_lng END AS provider_lng
       FROM bookings b
       LEFT JOIN service_providers sp ON b.provider_id = sp.id
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
    const result = await pool.query(
      `SELECT b.id, b.service_type, b.customer_id, b.provider_id, b.pickup_location, b.drop_or_service_address,
              b.fare_amount, b.duration_minutes, b.status, b.payment_confirmed_by_provider,
              b.created_at, b.completed_at, b.pickup_lat, b.pickup_lng, b.drop_lat, b.drop_lng, b.offered_at,
              c.name AS customer_name,
              CASE WHEN b.status IN ('accepted', 'ongoing', 'completed') THEN c.phone END AS customer_phone
       FROM bookings b
       LEFT JOIN customers c ON b.customer_id = c.id
       WHERE b.provider_id = $1
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
      estimated_fare,
      route_distance_km,
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
    const pickupLatitude = Number(pickup_lat);
    const pickupLongitude = Number(pickup_lng);
    if (!Number.isFinite(pickupLatitude) || !Number.isFinite(pickupLongitude)) {
      return res.status(400).json({ error: 'pickup_lat and pickup_lng must be valid numbers' });
    }
    if (pickupLatitude < -90 || pickupLatitude > 90 || pickupLongitude < -180 || pickupLongitude > 180) {
      return res.status(400).json({ error: 'pickup coordinates are out of range' });
    }

    const routeDistance = route_distance_km === undefined || route_distance_km === null || route_distance_km === '' ? null : Number(route_distance_km);
    const estimatedFare = estimated_fare === undefined || estimated_fare === null || estimated_fare === '' ? null : Number(estimated_fare);

    if (service_type === 'ride') {
      if (!Number.isFinite(routeDistance) || routeDistance <= 0 || routeDistance > 1000) {
        return res.status(400).json({ error: 'A valid route distance is required for a ride' });
      }
      if (!Number.isFinite(estimatedFare) || estimatedFare <= 0 || estimatedFare > 1000000) {
        return res.status(400).json({ error: 'A valid estimated fare is required for a ride' });
      }
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
       WHERE customer_id = $1 AND status IN ('requested', 'accepted', 'ongoing')
       LIMIT 1
       FOR UPDATE`,
      [customer_id]
    );
    if (open.rows.length > 0) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(409).json({ error: 'You already have an active booking' });
    }

    // Claim the provider inside the same transaction as the booking insert.
    // This prevents another booking from selecting the same provider between
    // "find nearest" and "mark unavailable".
    const nearest = await claimNearestProvider(
      client,
      provider_type,
      pickupLatitude,
      pickupLongitude,
      []
    );
    if (!nearest) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(404).json({ error: 'No available provider found nearby. Try again shortly.' });
    }

    const result = await client.query(
      `INSERT INTO bookings (
         service_type, provider_type, customer_id, provider_id, pickup_location, drop_or_service_address,
         pickup_lat, pickup_lng, fare_amount, start_pin, status, offered_at, declined_providers
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'requested', NOW(), '{}')
       RETURNING *`,
      [
        service_type, provider_type, customer_id, nearest.id, pickup_location, drop_or_service_address,
        pickupLatitude, pickupLongitude, estimatedFare, generatePin()
      ]
    );

    await client.query('COMMIT');
    inTransaction = false;

    // Send a background push after the booking is committed. This wakes the
    // provider's browser/OS even when the app tab is sleeping or backgrounded.
    // Foreground polling + buzzer remains as the fast path.
    pool.query(
      `SELECT endpoint, p256dh, auth
       FROM provider_push_subscriptions
       WHERE provider_id = $1`,
      [nearest.id]
    ).then(async (pushRows) => {
      for (const row of pushRows.rows) {
        const resultPush = await sendProviderPush(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          {
            title: 'Gofixo — New service request',
            body: `Pickup: ${pickup_location || 'Customer location'}`,
            tag: `gofixo-booking-${result.rows[0].id}`,
            booking_id: result.rows[0].id,
            url: '/?provider=request'
          }
        );
        if (resultPush && resultPush.expired) {
          await pool.query(
            'DELETE FROM provider_push_subscriptions WHERE provider_id = $1 AND endpoint = $2',
            [nearest.id, row.endpoint]
          );
        }
      }
    }).catch((err) => console.error('Provider push dispatch error:', err.message));

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
      `SELECT id, customer_id, provider_id, status
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

    if (current.provider_id) {
      const eligibility = await client.query(
        `SELECT 1
         FROM service_providers sp
         WHERE sp.id = $1
           AND sp.kyc_status = 'approved'
           AND sp.current_lat IS NOT NULL
           AND sp.current_lng IS NOT NULL
           AND sp.location_updated_at > NOW() - INTERVAL '5 minutes'
           AND NOT EXISTS (
             SELECT 1 FROM bookings b
             WHERE b.provider_id = sp.id
               AND b.status IN ('requested', 'accepted', 'ongoing')
               AND b.id <> $2
           )
           AND EXISTS (
             SELECT 1 FROM provider_subscriptions ps
             WHERE ps.provider_id = sp.id
               AND ps.status = 'active'
               AND ps.expiry_date > NOW()
           )`,
        [current.provider_id, id]
      );
      await client.query(
        'UPDATE service_providers SET is_available = $1 WHERE id = $2',
        [eligibility.rows.length > 0, current.provider_id]
      );
    }

    await client.query('COMMIT');
    inTransaction = false;
    res.json({ message: 'Booking cancelled', booking_id: Number(id) });
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
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
      `UPDATE bookings b SET status = 'accepted'
       WHERE b.id = $1
         AND b.provider_id = $2
         AND b.status = 'requested'
         AND NOT ($2 = ANY(COALESCE(b.declined_providers, '{}')))
         AND EXISTS (
           SELECT 1
           FROM service_providers sp
           WHERE sp.id = b.provider_id
             AND sp.kyc_status = 'approved'
             AND EXISTS (
               SELECT 1
               FROM provider_subscriptions ps
               WHERE ps.provider_id = sp.id
                 AND ps.status = 'active'
                 AND ps.expiry_date > NOW()
             )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM bookings active_b
           WHERE active_b.provider_id = b.provider_id
             AND active_b.status IN ('accepted', 'ongoing')
             AND active_b.id <> b.id
         )
       RETURNING b.id, b.service_type, b.customer_id, b.provider_id, b.pickup_location,
                 b.drop_or_service_address, b.status, b.pickup_lat, b.pickup_lng, b.created_at`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(409).json({
        error: 'This request is no longer available or your provider account is not currently eligible'
      });
    }

    await client.query('COMMIT');
    inTransaction = false;
    res.json(result.rows[0]);
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Provider declines — stays on duty; the request goes to the next nearest provider
router.post('/:id/decline', requireAuth(['provider']), async (req, res, next) => {
  try {
    const existing = await pool.query('SELECT provider_id, status FROM bookings WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    if (existing.rows[0].provider_id !== req.user.id || existing.rows[0].status !== 'requested') {
      return res.status(409).json({ error: 'This request is no longer available' });
    }
    await handleDeclineOrTimeout(req.params.id, false);
    res.json({ message: 'Request declined' });
  } catch (err) {
    next(err);
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

    const result = await pool.query(
      `UPDATE bookings
       SET status = 'ongoing', start_pin = NULL
       WHERE id = $1
         AND provider_id = $2
         AND status = 'accepted'
         AND start_pin = $3
       RETURNING id, service_type, customer_id, provider_id, pickup_location, status, created_at`,
      [id, req.user.id, normalizedPin]
    );

    if (result.rows.length > 0) {
      return res.json(result.rows[0]);
    }

    const existing = await pool.query(
      'SELECT provider_id, start_pin, status FROM bookings WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    if (existing.rows[0].provider_id !== req.user.id) {
      return res.status(403).json({ error: 'This booking does not belong to you' });
    }
    if (existing.rows[0].status !== 'accepted') {
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
    const { fare_amount, rating, comment } = req.body;
    const submittedFare = fare_amount === undefined || fare_amount === null || fare_amount === '' ? null : Number(fare_amount);
    if (submittedFare !== null && (!Number.isFinite(submittedFare) || submittedFare <= 0 || submittedFare > 1000000)) {
      return res.status(400).json({ error: 'fare_amount must be a positive amount up to 1000000' });
    }
    if (rating !== undefined && rating !== null && (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5)) {
      return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
    }
    if (comment !== undefined && comment !== null && (typeof comment !== 'string' || comment.length > 500)) {
      return res.status(400).json({ error: 'comment must be a string up to 500 characters' });
    }

    await client.query('BEGIN');

    const existing = await client.query('SELECT provider_id, status, fare_amount FROM bookings WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    if (existing.rows[0].provider_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This booking does not belong to you' });
    }

    const fare = submittedFare ?? Number(existing.rows[0].fare_amount);
    if (!Number.isFinite(fare) || fare <= 0 || fare > 1000000) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'A valid fare is required before completing this booking' });
    }

    // Complete only an ongoing booking. The status predicate makes payment
    // confirmation idempotent under concurrent requests: exactly one request
    // can transition ongoing -> completed and create the earning.
    const booking = await client.query(
      `UPDATE bookings SET status = 'completed', payment_confirmed_by_provider = true,
       fare_amount = $1, completed_at = NOW() WHERE id = $2
       AND provider_id = $3 AND status = 'ongoing'
       RETURNING id, service_type, customer_id, provider_id, pickup_location, fare_amount, status, completed_at`,
      [fare, id, req.user.id]
    );
    if (booking.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: existing.rows[0].status === 'ongoing'
          ? 'Payment is already being confirmed'
          : 'Start the ride/job with the customer\'s PIN before confirming payment'
      });
    }
    const providerId = booking.rows[0].provider_id;

    // Log the earning
    await client.query(
      `INSERT INTO earnings_log (booking_id, provider_id, amount) VALUES ($1, $2, $3)`,
      [id, providerId, fare]
    );

    // Close expired cycles first, then lock exactly one valid active cycle.
    // The row lock serializes concurrent booking completions for the same provider.
    await client.query(
      `UPDATE provider_subscriptions
       SET status = 'expired'
       WHERE provider_id = $1 AND status = 'active' AND expiry_date <= NOW()`,
      [providerId]
    );

    const sub = await client.query(
      `SELECT ps.id, ps.total_earned_this_cycle, sp.earning_cap AS cap
       FROM provider_subscriptions ps
       JOIN subscription_plans sp ON sp.id = ps.plan_id
       WHERE ps.provider_id = $1
         AND ps.status = 'active'
         AND ps.expiry_date > NOW()
       ORDER BY ps.start_date DESC, ps.id DESC
       LIMIT 1
       FOR UPDATE`,
      [providerId]
    );

    let providerAvailable = false;
    if (sub.rows.length > 0) {
      const currentEarned = Number(sub.rows[0].total_earned_this_cycle || 0);
      const earningCap = Number(sub.rows[0].cap);

      if (Number.isFinite(earningCap) && earningCap > 0) {
        const newTotal = currentEarned + fare;

        await client.query(
          `UPDATE provider_subscriptions
           SET total_earned_this_cycle = $1,
               status = CASE WHEN $1 >= $2 THEN 'exhausted' ELSE 'active' END
           WHERE id = $3`,
          [newTotal, earningCap, sub.rows[0].id]
        );

        providerAvailable = newTotal < earningCap;
      } else {
        // A malformed plan must never keep a provider available.
        await client.query(
          `UPDATE provider_subscriptions SET status = 'exhausted' WHERE id = $1`,
          [sub.rows[0].id]
        );
      }
    }

    // No valid subscription or an exhausted/invalid one means the provider must renew
    // before becoming available for another booking.
    await client.query(
      'UPDATE service_providers SET is_available = $1 WHERE id = $2',
      [providerAvailable, providerId]
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
    res.json({ booking: booking.rows[0], provider_available: providerAvailable });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
