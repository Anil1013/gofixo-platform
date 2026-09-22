const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

// List all bookings (admin panel)
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT b.*, sp.name AS provider_name, sp.generated_id, c.name AS customer_name
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

// Create a booking (ride or pronto) — customer must be logged in
// If provider_id isn't given, auto-matches the nearest available, KYC-approved provider of the requested type
router.post('/', requireAuth(['customer']), async (req, res, next) => {
  try {
    const { service_type, provider_type, provider_id, pickup_location, drop_or_service_address, pickup_lat, pickup_lng } = req.body;
    const customer_id = req.user.id;

    let matchedProviderId = provider_id;

    if (!matchedProviderId) {
      if (!provider_type) {
        return res.status(400).json({ error: 'provider_type is required when provider_id is not given (bike/car/general_worker/skilled_worker)' });
      }
      if (pickup_lat === undefined || pickup_lng === undefined) {
        return res.status(400).json({ error: 'pickup_lat and pickup_lng are required for matching' });
      }

      // Haversine distance (km) via SQL, ordered nearest-first
      const match = await pool.query(
        `SELECT id,
                ( 6371 * acos(
                    cos(radians($1)) * cos(radians(current_lat)) *
                    cos(radians(current_lng) - radians($2)) +
                    sin(radians($1)) * sin(radians(current_lat))
                  )
                ) AS distance_km
         FROM service_providers
         WHERE type = $3
           AND is_available = true
           AND kyc_status = 'approved'
           AND current_lat IS NOT NULL AND current_lng IS NOT NULL
         ORDER BY distance_km ASC
         LIMIT 1`,
        [pickup_lat, pickup_lng, provider_type]
      );

      if (match.rows.length === 0) {
        return res.status(404).json({ error: 'No available provider found nearby. Try again shortly.' });
      }
      matchedProviderId = match.rows[0].id;
    }

    const result = await pool.query(
      `INSERT INTO bookings (service_type, customer_id, provider_id, pickup_location, drop_or_service_address, pickup_lat, pickup_lng, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'requested') RETURNING *`,
      [service_type, customer_id, matchedProviderId, pickup_location, drop_or_service_address, pickup_lat, pickup_lng]
    );

    // Mark the matched provider busy immediately so they aren't double-booked
    await pool.query('UPDATE service_providers SET is_available = false WHERE id = $1', [matchedProviderId]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Provider confirms payment received — this is what unlocks their next booking
router.post('/:id/confirm-payment', requireAuth(['provider']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { fare_amount, rating, comment } = req.body;

    await client.query('BEGIN');

    const existing = await client.query('SELECT provider_id FROM bookings WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    if (existing.rows[0].provider_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This booking does not belong to you' });
    }

    const booking = await client.query(
      `UPDATE bookings SET status = 'completed', payment_confirmed_by_provider = true,
       fare_amount = $1, completed_at = NOW() WHERE id = $2 RETURNING *`,
      [fare_amount, id]
    );
    const providerId = booking.rows[0].provider_id;

    // Log the earning
    await client.query(
      `INSERT INTO earnings_log (booking_id, provider_id, amount) VALUES ($1, $2, $3)`,
      [id, providerId, fare_amount]
    );

    // Update the running total against the provider's active subscription
    const sub = await client.query(
      `UPDATE provider_subscriptions
       SET total_earned_this_cycle = total_earned_this_cycle + $1
       WHERE provider_id = $2 AND status = 'active'
       RETURNING *,
       (SELECT earning_cap FROM subscription_plans WHERE id = provider_subscriptions.plan_id) AS cap`,
      [fare_amount, providerId]
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
