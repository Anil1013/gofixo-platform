const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

// Register a new customer — phone + password (name optional)
router.post('/customer/register', async (req, res, next) => {
  try {
    const { name, phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'phone and password are required' });
    if (password.length < 4) return res.status(400).json({ error: 'password must be at least 4 characters' });

    const existing = await pool.query('SELECT id FROM customers WHERE phone = $1', [phone]);
    if (existing.rows.length) return res.status(409).json({ error: 'Phone already registered — please log in instead' });

    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO customers (name, phone, password_hash) VALUES ($1, $2, $3) RETURNING id, name, phone, created_at',
      [name || null, phone, password_hash]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Login (customer or provider) — phone + password
router.post('/:role/login', async (req, res, next) => {
  try {
    const { role } = req.params;
    const { phone, password } = req.body;
    if (!['customer', 'provider'].includes(role)) {
      return res.status(400).json({ error: 'role must be customer or provider' });
    }
    if (!phone || !password) return res.status(400).json({ error: 'phone and password are required' });

    const table = role === 'customer' ? 'customers' : 'service_providers';
    const result = await pool.query(`SELECT * FROM ${table} WHERE phone = $1`, [phone]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No account found with this phone number' });
    }
    const user = result.rows[0];
    if (!user.password_hash) {
      return res.status(401).json({ error: 'No password set on this account yet' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect password' });

    const token = jwt.sign({ id: user.id, role, phone }, process.env.JWT_SECRET, { expiresIn: '30d' });
    delete user.password_hash;
    res.json({ token, user });
  } catch (err) {
    next(err);
  }
});

// Reset password — self-service by phone number, no verification step.
// NOTE (security trade-off, by design): anyone who knows the phone number can reset that
// account's password this way. Fine for MVP/testing; revisit before a wider public launch
// (e.g. require the current password, or add a verification step back in).
router.post('/:role/reset-password', async (req, res, next) => {
  try {
    const { role } = req.params;
    const { phone, new_password } = req.body;
    if (!['customer', 'provider'].includes(role)) {
      return res.status(400).json({ error: 'role must be customer or provider' });
    }
    if (!phone || !new_password) return res.status(400).json({ error: 'phone and new_password are required' });
    if (new_password.length < 4) return res.status(400).json({ error: 'new_password must be at least 4 characters' });

    const table = role === 'customer' ? 'customers' : 'service_providers';
    const password_hash = await bcrypt.hash(new_password, 10);
    const result = await pool.query(`UPDATE ${table} SET password_hash = $1 WHERE phone = $2 RETURNING id`, [password_hash, phone]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No account found with this phone number' });
    }
    res.json({ message: 'Password reset successful — please log in with your new password' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
