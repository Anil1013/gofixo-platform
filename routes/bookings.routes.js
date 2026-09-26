const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
}

// List all bookings (admin panel)
router.get('/', async (req, res, next) => {
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

// A logged-in customer's own bookings
router.get('/mine', requireAuth(['customer']), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT b.*, sp.name AS provider_name, sp.generated_id AS provider_generated_id, sp.phone AS provider_phone
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

// A logged-in provider's own bookings
router.get('/mine/provider', requireAuth(['provider']), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT b.*, c.name AS customer_name, c.phone AS customer_phone
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

    const startPin = generatePin();

    const result = await pool.query(
      `INSERT INTO bookings (service_type, customer_id, provider_id, pickup_location, drop_or_service_address, pickup_lat, pickup_lng, start_pin, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'requested') RETURNING *`,
      [service_type, customer_id, matchedProviderId, pickup_location, drop_or_service_address, pickup_lat, pickup_lng, startPin]
    );

    // Mark the matched provider busy immediately so they aren't double-booked
    await pool.query('UPDATE service_providers SET is_available = false WHERE id = $1', [matchedProviderId]);

    res.status(201).json(result.rows[0]);
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
    if (booking.status !== 'requested') {
      return res.status(400).json({ error: `Booking is already ${booking.status}` });
    }
    if (booking.start_pin !== pin) {
      return res.status(401).json({ error: 'Incorrect PIN' });
    }

    const result = await pool.query(
      `UPDATE bookings SET status = 'ongoing' WHERE id = $1 RETURNING *`,
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
    if (!rating) return res.status(400).json({ error: 'rating is required' });

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
