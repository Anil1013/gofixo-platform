const express = require('express');
const router = express.Router();
const pool = require('../config/db');

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

// Create a booking (ride or pronto)
router.post('/', async (req, res, next) => {
  try {
    const { service_type, customer_id, provider_id, pickup_location, drop_or_service_address } = req.body;
    const result = await pool.query(
      `INSERT INTO bookings (service_type, customer_id, provider_id, pickup_location, drop_or_service_address, status)
       VALUES ($1, $2, $3, $4, $5, 'requested') RETURNING *`,
      [service_type, customer_id, provider_id, pickup_location, drop_or_service_address]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Provider confirms payment received — this is what unlocks their next booking
router.post('/:id/confirm-payment', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { fare_amount, rating, comment } = req.body;

    await client.query('BEGIN');

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
