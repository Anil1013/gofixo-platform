const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { findNearestProvider, handleDeclineOrTimeout } = require('../services/matching');

const SERVICE_TYPES = new Set(['ride', 'services']);
const PROVIDER_TYPES = new Set(['bike', 'auto', 'car', 'general_worker', 'skilled_worker']);

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
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
              b.created_at, b.completed_at, b.pickup_lat, b.pickup_lng, b.offered_at,
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
  try {
    const { service_type, provider_type, pickup_location, drop_or_service_address, pickup_lat, pickup_lng } = req.body;
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

    // One live booking at a time (stops a customer from locking up several providers at once)
    const open = await pool.query(
      `SELECT id FROM bookings WHERE customer_id = $1 AND status IN ('requested', 'accepted', 'ongoing') LIMIT 1`,
      [customer_id]
    );
    if (open.rows.length > 0) {
      return res.status(409).json({ error: 'You already have an active booking' });
    }

    const nearest = await findNearestProvider(provider_type, pickupLatitude, pickupLongitude, []);
    if (!nearest) {
      return res.status(404).json({ error: 'No available provider found nearby. Try again shortly.' });
    }

    const result = await pool.query(
      `INSERT INTO bookings (service_type, provider_type, customer_id, provider_id, pickup_location, drop_or_service_address,
                             pickup_lat, pickup_lng, start_pin, status, offered_at, declined_providers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'requested', NOW(), '{}') RETURNING *`,
      [service_type, provider_type, customer_id, nearest.id, pickup_location, drop_or_service_address,
       pickupLatitude, pickupLongitude, generatePin()]
    );

    // Hold the provider while the offer is open so they aren't offered a second job
    await pool.query('UPDATE service_providers SET is_available = false WHERE id = $1', [nearest.id]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Provider accepts the request that is buzzing on their phone
router.post('/:id/accept', requireAuth(['provider']), async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE bookings SET status = 'accepted'
       WHERE id = $1 AND provider_id = $2 AND status = 'requested'
         AND NOT ($2 = ANY(COALESCE(declined_providers, '{}')))
       RETURNING id, service_type, customer_id, provider_id, pickup_location, drop_or_service_address,
                 status, pickup_lat, pickup_lng, created_at`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'This request is no longer available (it may have timed out)' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
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

// Provider starts the ride/job by entering the PIN the customer sees on their dashboard
router.post('/:id/start', requireAuth(['provider']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'pin is required' });

    const existing = await pool.query('SELECT provider_id, start_pin, status FROM bookings WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = existing.rows[0];

    if (booking.provider_id !== req.user.id) {
      return res.status(403).json({ error: 'This booking does not belong to you' });
    }
    if (booking.status !== 'accepted') {
      return res.status(400).json({ error: booking.status === 'requested' ? 'Accept the request first' : `Booking is already ${booking.status}` });
    }
    if (booking.start_pin !== pin) {
      return res.status(401).json({ error: 'Incorrect PIN' });
    }

    const result = await pool.query(
      `UPDATE bookings SET status = 'ongoing' WHERE id = $1
       RETURNING id, service_type, customer_id, provider_id, pickup_location, status, created_at`,
      [id]
    );
    res.json(result.rows[0]);
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

    await client.query('BEGIN');
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
    const fare = Number(fare_amount);
    if (!Number.isFinite(fare) || fare <= 0 || fare > 1000000) {
      return res.status(400).json({ error: 'fare_amount must be a positive amount up to 1000000' });
    }
    if (rating !== undefined && rating !== null && (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5)) {
      return res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
    }

    await client.query('BEGIN');

    const existing = await client.query('SELECT provider_id, status FROM bookings WHERE id = $1', [id]);
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
      return res.status(400).json({ error: 'Start the ride/job with the customer\'s PIN before confirming payment' });
    }

    const booking = await client.query(
      `UPDATE bookings SET status = 'completed', payment_confirmed_by_provider = true,
       fare_amount = $1, completed_at = NOW() WHERE id = $2
       RETURNING id, service_type, customer_id, provider_id, pickup_location, fare_amount, status, completed_at`,
      [fare, id]
    );
    const providerId = booking.rows[0].provider_id;

    // Log the earning
    await client.query(
      `INSERT INTO earnings_log (booking_id, provider_id, amount) VALUES ($1, $2, $3)`,
      [id, providerId, fare]
    );

    // Update the running total against the provider's active subscription
    const sub = await client.query(
      `UPDATE provider_subscriptions
       SET total_earned_this_cycle = total_earned_this_cycle + $1
       WHERE provider_id = $2 AND status = 'active'
       RETURNING *,
       (SELECT earning_cap FROM subscription_plans WHERE id = provider_subscriptions.plan_id) AS cap`,
      [fare, providerId]
    );

    let providerAvailable = true;
    if (sub.rows.length > 0 && parseFloat(sub.rows[0].total_earned_this_cycle) >= parseFloat(sub.rows[0].cap)) {
      await client.query(`UPDATE provider_subscriptions SET status = 'exhausted' WHERE id = $1`, [sub.rows[0].id]);
      providerAvailable = false; // provider must renew before going available again
    }

    await client.query('UPDATE service_providers SET is_available = $1 WHERE id = $2', [providerAvailable, providerId]);

    if (rating) {
      await client.query(
        `INSERT INTO booking_ratings (booking_id, rated_by, rating, comment) VALUES ($1, 'provider', $2, $3)`,
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
