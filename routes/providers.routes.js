const express = require('express');
const router = express.Router();
const pool = require('../config/db');

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
