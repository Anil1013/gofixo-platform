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
      `SELECT c.id, c.name, c.phone, c.profile_photo_url, c.created_at,
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
router.get('/customers/:id/profile-photo', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid customer ID' });
    const result = await pool.query('SELECT profile_photo_url FROM customers WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    if (!result.rows[0].profile_photo_url) return res.status(404).json({ error: 'Profile photo not set' });
    const relativePath = result.rows[0].profile_photo_url.replace(/^\/uploads\//, '');
    const path = require('path');
    const fs = require('fs');
    const filePath = path.resolve(__dirname, '..', 'uploads', relativePath);
    const uploadsRoot = path.resolve(__dirname, '..', 'uploads') + path.sep;
    if (!filePath.startsWith(uploadsRoot)) return res.status(400).json({ error: 'Invalid photo path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Profile photo file not found' });
    res.sendFile(filePath);
  } catch (err) { next(err); }
});

router.get('/customers/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid customer ID' });

    const result = await pool.query(
      `SELECT c.id, c.name, c.phone, c.profile_photo_url, c.created_at,
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

    // Keep the actual password reset independent of optional audit columns on
    // older production databases. The password itself is always stored as a hash.
    await pool.query(
      `UPDATE customers
       SET password_hash = $1
       WHERE id = $2`,
      [passwordHash, id]
    );

    // Record the password-change timestamp when the additive column is available.
    // ensureRuntimeSchema creates it on new deployments, while this fallback keeps
    // resets working against an older database during rollout.
    try {
      await pool.query(
        `UPDATE customers SET password_changed_at = NOW() WHERE id = $1`,
        [id]
      );
    } catch (timestampError) {
      if (timestampError?.code !== '42703') throw timestampError;
      console.warn('password_changed_at is not available yet; password reset still completed');
    }

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

router.get('/payouts', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '100', 10) || 100, 1), 250);
    const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
    const params = [], where = [];
    if (status) {
      if (!['pending', 'paid', 'failed', 'processing'].includes(status)) return res.status(400).json({ error: 'Invalid payout status' });
      params.push(status); where.push(`pp.payout_status = ${params.length}`);
    }
    params.push(limit);
    const result = await pool.query(
      `SELECT pp.id, pp.booking_id, pp.provider_id, sp.generated_id, sp.name AS provider_name,
              pp.gross_amount, pp.platform_fee, pp.payout_amount, pp.payout_method,
              pp.payout_status, pp.provider_reference, pp.failure_reason, pp.created_at, pp.paid_at
       FROM partner_payouts pp JOIN service_providers sp ON sp.id = pp.provider_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY pp.created_at DESC, pp.id DESC LIMIT ${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
