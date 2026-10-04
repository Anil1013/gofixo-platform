const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { promises: fsp } = fs;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { isValidPassword, PASSWORD_ERROR } = require('../utils/password');
const { checkLoginRateLimit, recordFailedLogin, clearLoginFailures } = require('../utils/loginRateLimit');
const { requireAuth } = require('../middleware/auth');

const profileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return cb(Object.assign(new Error('Only JPG, PNG, and WEBP profile photos are allowed'), { status: 400 }));
    if (file.mimetype && !['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'].includes(file.mimetype)) return cb(Object.assign(new Error('Only JPG, PNG, and WEBP profile photos are allowed'), { status: 400 }));
    cb(null, true);
  },
});

function normalizeIndianPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return '';
}

// Register a new customer — phone + password (name optional)
router.post('/customer/register', async (req, res, next) => {
  try {
    const { name, phone, password } = req.body;
    const normalizedPhone = normalizeIndianPhone(phone);
    if (!normalizedPhone || !password) return res.status(400).json({ error: 'Valid 10-digit Indian phone number and password are required' });
    if (!isValidPassword(password)) return res.status(400).json({ error: PASSWORD_ERROR });

    const existing = await pool.query('SELECT id FROM customers WHERE phone = $1', [normalizedPhone]);
    if (existing.rows.length) return res.status(409).json({ error: 'Phone already registered — please log in instead' });

    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO customers (name, phone, password_hash) VALUES ($1, $2, $3) RETURNING id, name, phone, created_at',
      [name || null, normalizedPhone, password_hash]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Customer profile photo upload and authenticated image access.
router.post('/customer/profile-photo', requireAuth(['customer']), profileUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const dir = path.join(__dirname, '..', 'uploads', 'customers', String(req.user.id));
    await fsp.mkdir(dir, { recursive: true });
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const filename = 'profile-' + crypto.randomBytes(16).toString('hex') + ext;
    const filePath = path.join(dir, filename);
    await fsp.writeFile(filePath, req.file.buffer, { flag: 'wx' });
    const fileUrl = '/uploads/customers/' + req.user.id + '/' + filename;
    await pool.query('UPDATE customers SET profile_photo_url = $1 WHERE id = $2', [fileUrl, req.user.id]);
    res.status(201).json({ profile_photo_url: fileUrl });
  } catch (err) { next(err); }
});

router.get('/customer/profile-photo', requireAuth(['customer']), async (req, res, next) => {
  try {
    const result = await pool.query('SELECT profile_photo_url FROM customers WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0 || !result.rows[0].profile_photo_url) return res.status(404).json({ error: 'Profile photo not set' });
    const relativePath = result.rows[0].profile_photo_url.replace(/^\/uploads\//, '');
    const filePath = path.resolve(__dirname, '..', 'uploads', relativePath);
    const uploadsRoot = path.resolve(__dirname, '..', 'uploads') + path.sep;
    if (!filePath.startsWith(uploadsRoot)) return res.status(400).json({ error: 'Invalid photo path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Profile photo file not found' });
    res.sendFile(filePath);
  } catch (err) { next(err); }
});

// Login (customer or provider) — phone + password
async function loginHandler(req, res, next) {
  try {
    const { role } = req.params;
    const { phone, password } = req.body;
    const normalizedPhone = normalizeIndianPhone(phone);
    if (!['customer', 'provider'].includes(role)) {
      return res.status(400).json({ error: 'role must be customer or provider' });
    }
    if (!normalizedPhone || !password) return res.status(400).json({ error: 'Valid 10-digit Indian phone number and password are required' });

    const retryAfter = checkLoginRateLimit(req.ip, role, normalizedPhone);
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }

    const table = role === 'customer' ? 'customers' : 'service_providers';
    const result = await pool.query(`SELECT * FROM ${table} WHERE phone = $1 OR RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1 LIMIT 1`, [normalizedPhone]);
    if (result.rows.length === 0) {
      recordFailedLogin(req.ip, role, normalizedPhone);
      return res.status(401).json({ error: 'Invalid phone number or password' });
    }
    const user = result.rows[0];
    if (!user.password_hash) {
      recordFailedLogin(req.ip, role, normalizedPhone);
      return res.status(401).json({ error: 'Invalid phone number or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      recordFailedLogin(req.ip, role, normalizedPhone);
      return res.status(401).json({ error: 'Invalid phone number or password' });
    }

    clearLoginFailures(req.ip, role, normalizedPhone);

    const token = jwt.sign({ id: user.id, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    delete user.password_hash;
    res.json({ token, user });
  } catch (err) {
    next(err);
  };
}


router.post('/customer/login', loginHandler);
router.post('/provider/login', loginHandler);
// Keep the role-based route for backwards compatibility.
router.post('/:role/login', loginHandler);

// Request a password reset without revealing whether the phone exists.
// This creates an admin-visible request; it does not change the password by itself.
router.post('/:role/forgot-password', async (req, res, next) => {
  try {
    const { role } = req.params;
    const normalizedPhone = normalizeIndianPhone(req.body?.phone);
    if (!['customer', 'provider'].includes(role)) {
      return res.status(400).json({ error: 'role must be customer or provider' });
    }
    if (!normalizedPhone) return res.status(400).json({ error: 'Valid 10-digit Indian phone number is required' });

    // Keep this endpoint safe: knowing a phone number alone never changes the password.
    const table = role === 'customer' ? 'customers' : 'service_providers';
    const result = await pool.query(
      `SELECT id FROM ${table}
       WHERE phone = $1 OR RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1
       LIMIT 1`,
      [normalizedPhone]
    );

    if (role === 'customer' && result.rows.length > 0) {
      await pool.query(
        `INSERT INTO password_reset_requests (customer_id, status)
         VALUES ($1, 'pending')
         ON CONFLICT (customer_id)
         WHERE status = 'pending'
         DO NOTHING`,
        [result.rows[0].id]
      );
    }

    // Same response whether the account exists or not to reduce account enumeration.
    res.json({ message: 'If the account exists, a password reset request has been created. An administrator can complete the reset.' });
  } catch (err) {
    next(err);
  }
});

// Change password while already signed in. The existing password is still required here.
router.post('/:role/reset-password', async (req, res, next) => {
  try {
    const { role } = req.params;
    const { phone, current_password, new_password } = req.body;
    const normalizedPhone = normalizeIndianPhone(phone);
    if (!['customer', 'provider'].includes(role)) {
      return res.status(400).json({ error: 'role must be customer or provider' });
    }
    if (!normalizedPhone || !current_password || !new_password) {
      return res.status(400).json({ error: 'phone, current_password and new_password are required' });
    }
    if (!isValidPassword(new_password)) return res.status(400).json({ error: PASSWORD_ERROR });
    if (current_password === new_password) {
      return res.status(400).json({ error: 'New password must be different from the current password' });
    }

    const table = role === 'customer' ? 'customers' : 'service_providers';
    const result = await pool.query(`SELECT id, password_hash FROM ${table} WHERE phone = $1`, [normalizedPhone]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No account found with this phone number' });
    }

    const valid = await bcrypt.compare(current_password, result.rows[0].password_hash || '');
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const password_hash = await bcrypt.hash(new_password, 10);
    await pool.query(`UPDATE ${table} SET password_hash = $1, password_changed_at = NOW() WHERE id = $2`, [password_hash, result.rows[0].id]);

    res.json({ message: 'Password changed successfully — please log in with your new password' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
