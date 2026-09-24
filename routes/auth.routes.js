const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// In-memory OTP store — fine for MVP testing, but resets on server restart.
// Before real launch: move to a table with expiry.
const otpStore = new Map(); // key: `${role}:${phone}` -> { otp, expiresAt }

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
}

// Sends the OTP via Fast2SMS's 'otp' route (no DLT registration needed, works immediately).
// Falls back to dev-mode (no real SMS sent) if no gateway is configured — caller decides whether
// to expose the OTP in the response in that case.
async function sendOtpSms(phone, otp) {
  const { FAST2SMS_API_KEY } = process.env;
  if (!FAST2SMS_API_KEY) {
    return { sent: false, reason: 'FAST2SMS_API_KEY not set' };
  }
  try {
    const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${FAST2SMS_API_KEY}&route=otp&variables_values=${otp}&numbers=${phone}`;
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    if (data.return === true) return { sent: true };
    return { sent: false, reason: JSON.stringify(data.message || data) };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

// Request an OTP — role is 'customer' or 'provider'
router.post('/:role/otp/request', async (req, res) => {
  const { role } = req.params;
  const { phone } = req.body;
  if (!['customer', 'provider'].includes(role)) {
    return res.status(400).json({ error: 'role must be customer or provider' });
  }
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const otp = generateOtp();
  otpStore.set(`${role}:${phone}`, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });

  const smsResult = await sendOtpSms(phone, otp);

  if (smsResult.sent) {
    // Real SMS sent — never echo the OTP back in the response.
    res.json({ message: 'OTP sent to your phone' });
  } else {
    // Dev-mode fallback: no SMS gateway active yet, so return the OTP directly for testing.
    console.warn(`SMS not sent (${smsResult.reason}) — returning OTP in response for dev testing`);
    res.json({ message: 'OTP generated (dev mode — SMS not yet active)', otp });
  }
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
