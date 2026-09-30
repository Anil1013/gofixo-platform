const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAdmin } = require('../middleware/admin');
const { isValidPassword, PASSWORD_ERROR } = require('../utils/password');

const router = express.Router();

router.use(requireAdmin);

// Customer list for the admin console. Never return password hashes.
router.get('/customers', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.name, c.phone, c.created_at,
              CASE WHEN c.password_hash IS NULL THEN false ELSE true END AS has_password,
              EXISTS (
                SELECT 1 FROM password_reset_requests pr
                WHERE pr.customer_id = c.id AND pr.status = 'pending'
              ) AS reset_requested
       FROM customers c
       ORDER BY c.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Customer details. Password is intentionally not exposed because the database stores
// only a bcrypt hash, not the original password.
router.get('/customers/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid customer ID' });

    const result = await pool.query(
      `SELECT c.id, c.name, c.phone, c.created_at,
              CASE WHEN c.password_hash IS NULL THEN false ELSE true END AS has_password,
              NULL::text AS aadhaar_number
       FROM customers c
       WHERE c.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });

    const requests = await pool.query(
      `SELECT id, status, created_at, resolved_at
       FROM password_reset_requests
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [id]
    );

    res.json({ customer: result.rows[0], reset_requests: requests.rows });
  } catch (err) {
    next(err);
  }
});

// Admin can resolve a customer's forgotten-password request by setting a new password.
// The plaintext password is accepted only for this request and is immediately bcrypt-hashed.
router.post('/customers/:id/reset-password', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const { new_password } = req.body || {};
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid customer ID' });
    if (!isValidPassword(new_password)) return res.status(400).json({ error: PASSWORD_ERROR });

    const customer = await pool.query('SELECT id FROM customers WHERE id = $1', [id]);
    if (customer.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });

    const passwordHash = await bcrypt.hash(new_password, 10);
    await pool.query(
      `UPDATE customers
       SET password_hash = $1, password_changed_at = NOW()
       WHERE id = $2`,
      [passwordHash, id]
    );

    await pool.query(
      `UPDATE password_reset_requests
       SET status = 'resolved', resolved_at = NOW()
       WHERE customer_id = $1 AND status = 'pending'`,
      [id]
    );

    res.json({ message: 'Customer password reset successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
