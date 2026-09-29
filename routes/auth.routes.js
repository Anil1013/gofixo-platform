const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { isValidPassword, PASSWORD_ERROR } = require('../utils/password');

// Register a new customer — phone + password (name optional)
router.post('/customer/register', async (req, res, next) => {
  try {
    const { name, phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'phone and password are required' });
    if (!isValidPassword(password)) return res.status(400).json({ error: PASSWORD_ERROR });

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

// Change password using the existing password.
// A phone number alone must never be sufficient to take over an account.
// A true "forgot password" flow should be added only when a verified OTP/email
// provider is configured for this deployment.
router.post('/:role/reset-password', async (req, res, next) => {
  try {
    const { role } = req.params;
    const { phone, current_password, new_password } = req.body;
    if (!['customer', 'provider'].includes(role)) {
      return res.status(400).json({ error: 'role must be customer or provider' });
    }
    if (!phone || !current_password || !new_password) {
      return res.status(400).json({ error: 'phone, current_password and new_password are required' });
    }
    if (!isValidPassword(new_password)) return res.status(400).json({ error: PASSWORD_ERROR });
    if (current_password === new_password) {
      return res.status(400).json({ error: 'New password must be different from the current password' });
    }

    const table = role === 'customer' ? 'customers' : 'service_providers';
    const result = await pool.query(`SELECT id, password_hash FROM ${table} WHERE phone = $1`, [phone]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No account found with this phone number' });
    }

    const valid = await bcrypt.compare(current_password, result.rows[0].password_hash || '');
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const password_hash = await bcrypt.hash(new_password, 10);
    await pool.query(`UPDATE ${table} SET password_hash = $1 WHERE id = $2`, [password_hash, result.rows[0].id]);

    res.json({ message: 'Password changed successfully — please log in with your new password' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
