const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

// List all subscription plans (admin panel)
router.get('/plans', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM subscription_plans ORDER BY provider_type, fee');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Provider buys/renews their own plan
router.post('/subscribe', requireAuth(['provider']), async (req, res, next) => {
  try {
    const { plan_id } = req.body;
    const provider_id = req.user.id;

    const plan = await pool.query('SELECT * FROM subscription_plans WHERE id = $1', [plan_id]);
    if (plan.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });

    const validityDays = plan.rows[0].validity_days;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + validityDays);

    const result = await pool.query(
      `INSERT INTO provider_subscriptions (provider_id, plan_id, expiry_date, total_earned_this_cycle, status)
       VALUES ($1, $2, $3, 0, 'active') RETURNING *`,
      [provider_id, plan_id, expiryDate]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Check a provider's current subscription status (used before allowing them to go "available")
router.get('/status/:providerId', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ps.*, sp.fee, sp.earning_cap, sp.plan_name
       FROM provider_subscriptions ps
       JOIN subscription_plans sp ON ps.plan_id = sp.id
       WHERE ps.provider_id = $1
       ORDER BY ps.start_date DESC LIMIT 1`,
      [req.params.providerId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No subscription found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
