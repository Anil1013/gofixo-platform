const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// In-memory OTP store — fine for MVP testing, but resets on server restart.
// Before real launch: move to a table with expiry, and send via an SMS gateway (MSG91/Twilio) instead of returning it in the response.
const otpStore = new Map(); // key: `${role}:${phone}` -> { otp, expiresAt }

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
}

// Request an OTP — role is 'customer' or 'provider'
router.post('/:role/otp/request', (req, res) => {
  const { role } = req.params;
  const { phone } = req.body;
  if (!['customer', 'provider'].includes(role)) {
    return res.status(400).json({ error: 'role must be customer or provider' });
  }
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const otp = generateOtp();
  otpStore.set(`${role}:${phone}`, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

  // TEMPORARY: returning OTP directly for testing since no SMS gateway is connected yet.
  // Remove `otp` from this response once a real SMS provider is wired up.
  res.json({ message: 'OTP generated', otp });
});

// Verify OTP and issue a JWT
router.post('/:role/otp/verify', async (req, res, next) => {
  try {
    const { role } = req.params;
    const { phone, otp, name } = req.body;
    const key = `${role}:${phone}`;
    const record = otpStore.get(key);

    if (!record || record.otp !== otp || Date.now() > record.expiresAt) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }
    otpStore.delete(key);

    let user;
    if (role === 'customer') {
      const existing = await pool.query('SELECT * FROM customers WHERE phone = $1', [phone]);
      if (existing.rows.length) {
        user = existing.rows[0];
      } else {
        const created = await pool.query(
          'INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING *',
          [name || null, phone]
        );
        user = created.rows[0];
      }
    } else {
      const existing = await pool.query('SELECT * FROM service_providers WHERE phone = $1', [phone]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Provider not registered. Register first via /api/providers/register' });
      }
      user = existing.rows[0];
    }

    const token = jwt.sign({ id: user.id, role, phone }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
