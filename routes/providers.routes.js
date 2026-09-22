const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

// Register a new provider (driver/worker) — KYC starts as 'pending'
router.post('/register', async (req, res, next) => {
  try {
    const { name, phone, type } = req.body;
    if (!name || !phone || !type) {
      return res.status(400).json({ error: 'name, phone and type are required' });
    }

    // generated_id pattern: RL-D-00231 (driver) or RL-W-00512 (worker)
    const prefix = (type === 'bike' || type === 'car') ? 'D' : 'W';
    const countResult = await pool.query('SELECT COUNT(*) FROM service_providers WHERE type = $1', [type]);
    const nextNumber = String(parseInt(countResult.rows[0].count, 10) + 1).padStart(5, '0');
    const generatedId = `RL-${prefix}-${nextNumber}`;

    const result = await pool.query(
      `INSERT INTO service_providers (generated_id, name, phone, type)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [generatedId, name, phone, type]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// List all providers (admin panel)
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM service_providers ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Update KYC status (admin approve/reject)
router.patch('/:id/kyc', async (req, res, next) => {
  try {
    const { status } = req.body; // 'approved' or 'rejected'
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved, rejected, or pending' });
    }
    const result = await pool.query(
      'UPDATE service_providers SET kyc_status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Provider toggles their own availability (go online/offline)
router.patch('/:id/availability', requireAuth(['provider']), async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return res.status(403).json({ error: 'You can only update your own availability' });
    }
    const { is_available } = req.body;

    // Block going available if their active subscription is exhausted/missing
    if (is_available) {
      const sub = await pool.query(
        `SELECT status FROM provider_subscriptions WHERE provider_id = $1 ORDER BY start_date DESC LIMIT 1`,
        [req.params.id]
      );
      if (sub.rows.length === 0 || sub.rows[0].status !== 'active') {
        return res.status(403).json({ error: 'No active subscription — renew your plan to go available' });
      }
    }

    const result = await pool.query(
      'UPDATE service_providers SET is_available = $1 WHERE id = $2 RETURNING *',
      [is_available, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Provider updates their live location (called periodically by the driver/worker app)
router.patch('/:id/location', requireAuth(['provider']), async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return res.status(403).json({ error: 'You can only update your own location' });
    }
    const { lat, lng } = req.body;
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }
    const result = await pool.query(
      'UPDATE service_providers SET current_lat = $1, current_lng = $2 WHERE id = $3 RETURNING *',
      [lat, lng, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Get provider by generated_id
router.get('/:generatedId', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM service_providers WHERE generated_id = $1',
      [req.params.generatedId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
