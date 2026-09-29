const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { isValidPassword, PASSWORD_ERROR } = require('../utils/password');

const PROVIDER_TYPES = ['bike', 'auto', 'car', 'general_worker', 'skilled_worker'];

const ALLOWED_DOCUMENT_TYPES = new Set([
  'aadhar_front', 'aadhar_back', 'driving_license', 'vehicle_rc',
  'vehicle_photo_front', 'vehicle_photo_back', 'profile_photo', 'police_verification',
]);
const ALLOWED_UPLOAD_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.pdf']);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'uploads', 'providers', String(req.params.id));
      require('fs').mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const random = crypto.randomBytes(8).toString('hex'); // avoids guessable URLs
      cb(null, `${req.body.doc_type || 'doc'}-${random}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype) || !ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
      return cb(Object.assign(new Error('Only JPG, PNG, and PDF files are allowed'), { status: 400 }));
    }
    cb(null, true);
  },
});

// Register a new provider (driver/worker) — KYC starts as 'pending'
router.post('/register', async (req, res, next) => {
  try {
    const { name, phone, type, password } = req.body;
    if (!name || !phone || !type || !password) {
      return res.status(400).json({ error: 'name, phone, type and password are required' });
    }
    if (!PROVIDER_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid provider type' });
    }
    if (!isValidPassword(password)) return res.status(400).json({ error: PASSWORD_ERROR });

    // generated_id pattern: RL-D-00231 (driver) or RL-W-00512 (worker).
    // COUNT()+1 is race-prone: two concurrent registrations can receive the same ID.
    // Serialize ID allocation per provider type with a PostgreSQL transaction advisory lock.
    const prefix = ['bike', 'car', 'auto'].includes(type) ? 'D' : 'W';
    const client = await pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;

      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gofixo-provider-id:${type}`]);

      const maxResult = await client.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(generated_id FROM 6) AS INTEGER)), 0) AS max_number
         FROM service_providers
         WHERE type = $1 AND generated_id LIKE $2`,
        [type, `RL-${prefix}-%`]
      );
      const nextNumber = String(Number(maxResult.rows[0].max_number) + 1).padStart(5, '0');
      const generatedId = `RL-${prefix}-${nextNumber}`;
      const passwordHash = await bcrypt.hash(password, 10);

      const result = await client.query(
        `INSERT INTO service_providers (generated_id, name, phone, type, password_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, generated_id, name, phone, type, kyc_status, created_at`,
        [generatedId, name, phone, type, passwordHash]
      );

      await client.query('COMMIT');
      inTransaction = false;
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (inTransaction) await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// List all providers (admin panel) — includes active plan, pending (cap remaining), and uploaded documents
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT sp.id, sp.generated_id, sp.name, sp.phone, sp.type, sp.kyc_status, sp.bank_upi_id,
        sp.avg_rating, sp.is_available, sp.created_at, sp.current_lat, sp.current_lng,
        sub.plan_name,
        sub.earning_cap,
        sub.total_earned_this_cycle,
        CASE WHEN sub.earning_cap IS NOT NULL
             THEN sub.earning_cap - sub.total_earned_this_cycle
             ELSE NULL END AS pending_amount,
        COALESCE(docs.documents, '[]') AS documents
      FROM service_providers sp
      LEFT JOIN LATERAL (
        SELECT ps.total_earned_this_cycle, spl.plan_name, spl.earning_cap
        FROM provider_subscriptions ps
        JOIN subscription_plans spl ON spl.id = ps.plan_id
        WHERE ps.provider_id = sp.id
          AND ps.status = 'active'
          AND ps.expiry_date > NOW()
        ORDER BY ps.start_date DESC LIMIT 1
      ) sub ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('doc_type', doc_type, 'file_url', file_url) ORDER BY uploaded_at DESC) AS documents
        FROM provider_documents pd WHERE pd.provider_id = sp.id
      ) docs ON true
      ORDER BY sp.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Authenticated provider/admin access to a stored KYC document.
router.get('/:id/documents/:documentId', requireAuth(['provider']), async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return res.status(403).json({ error: 'You can only access your own documents' });
    }
    const result = await pool.query(
      'SELECT file_url FROM provider_documents WHERE id = $1 AND provider_id = $2',
      [req.params.documentId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

    const relativePath = result.rows[0].file_url.replace(/^\\/uploads\\//, '');
    const filePath = path.resolve(__dirname, '..', 'uploads', relativePath);
    const uploadsRoot = path.resolve(__dirname, '..', 'uploads') + path.sep;
    if (!filePath.startsWith(uploadsRoot)) return res.status(400).json({ error: 'Invalid document path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Document file not found' });

    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

// Provider uploads a KYC document (doc_type: aadhar / driving_license / vehicle_rc / vehicle_photo / profile_photo / police_verification)
router.post('/:id/documents', requireAuth(['provider']), upload.single('file'), async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return res.status(403).json({ error: 'You can only upload your own documents' });
    }
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    if (!ALLOWED_DOCUMENT_TYPES.has(req.body.doc_type)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Invalid document type' });
    }
    const fileUrl = `/uploads/providers/${req.params.id}/${req.file.filename}`;
    const result = await pool.query(
      'INSERT INTO provider_documents (provider_id, doc_type, file_url) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, req.body.doc_type, fileUrl]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

const REQUIRED_DOCS = {
  bike: ['aadhar_front', 'aadhar_back', 'driving_license', 'vehicle_rc', 'vehicle_photo_front', 'vehicle_photo_back'],
  car: ['aadhar_front', 'aadhar_back', 'driving_license', 'vehicle_rc', 'vehicle_photo_front', 'vehicle_photo_back'],
  auto: ['aadhar_front', 'aadhar_back', 'driving_license', 'vehicle_rc', 'vehicle_photo_front', 'vehicle_photo_back'],
};

// Update KYC status (admin approve/reject)
router.patch('/:id/kyc', requireAdmin, async (req, res, next) => {
  try {
    const { status } = req.body; // 'approved' or 'rejected'
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved, rejected, or pending' });
    }

    if (status === 'approved') {
      const provider = await pool.query('SELECT type FROM service_providers WHERE id = $1', [req.params.id]);
      if (provider.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
      const required = REQUIRED_DOCS[provider.rows[0].type];
      if (required) {
        const docs = await pool.query('SELECT doc_type FROM provider_documents WHERE provider_id = $1', [req.params.id]);
        const uploaded = new Set(docs.rows.map((d) => d.doc_type));
        const missing = required.filter((r) => !uploaded.has(r));
        if (missing.length > 0) {
          return res.status(400).json({ error: `Cannot approve — missing required documents: ${missing.join(', ')}` });
        }
      }
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
    if (typeof is_available !== 'boolean') {
      return res.status(400).json({ error: 'is_available must be a boolean' });
    }

    // Block going available if the provider has no non-expired active subscription.
    if (is_available) {
      await pool.query(
        `UPDATE provider_subscriptions
         SET status = 'expired'
         WHERE provider_id = $1 AND status = 'active' AND expiry_date <= NOW()`,
        [req.params.id]
      );
      const sub = await pool.query(
        `SELECT status, current_lat, current_lng
         FROM provider_subscriptions
         JOIN service_providers ON service_providers.id = provider_subscriptions.provider_id
         WHERE provider_subscriptions.provider_id = $1
           AND provider_subscriptions.status = 'active'
           AND provider_subscriptions.expiry_date > NOW()
         ORDER BY provider_subscriptions.start_date DESC LIMIT 1`,
        [req.params.id]
      );
      if (sub.rows.length === 0) {
        return res.status(403).json({ error: 'No active subscription — renew your plan to go available' });
      }
      if (sub.rows[0].current_lat === null || sub.rows[0].current_lng === null) {
        return res.status(400).json({ error: 'Share your current location before going available' });
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
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: 'lat and lng must be valid numbers' });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'lat or lng is out of range' });
    }
    const result = await pool.query(
      'UPDATE service_providers SET current_lat = $1, current_lng = $2 WHERE id = $3 RETURNING *',
      [latitude, longitude, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Logged-in provider's own profile — plan, pending amount, documents
router.get('/me', requireAuth(['provider']), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT sp.*,
        sub.plan_name,
        sub.earning_cap,
        sub.total_earned_this_cycle,
        CASE WHEN sub.earning_cap IS NOT NULL
             THEN sub.earning_cap - sub.total_earned_this_cycle
             ELSE NULL END AS pending_amount,
        COALESCE(docs.documents, '[]') AS documents
      FROM service_providers sp
      LEFT JOIN LATERAL (
        SELECT ps.total_earned_this_cycle, spl.plan_name, spl.earning_cap
        FROM provider_subscriptions ps
        JOIN subscription_plans spl ON spl.id = ps.plan_id
        WHERE ps.provider_id = sp.id
          AND ps.status = 'active'
          AND ps.expiry_date > NOW()
        ORDER BY ps.start_date DESC LIMIT 1
      ) sub ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('doc_type', doc_type, 'file_url', file_url) ORDER BY uploaded_at DESC) AS documents
        FROM provider_documents pd WHERE pd.provider_id = sp.id
      ) docs ON true
      WHERE sp.id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Available subscription plans for a given provider type
router.get('/plans/:type', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM subscription_plans WHERE provider_type = $1 ORDER BY fee',
      [req.params.type]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Get provider by generated_id
router.get('/:generatedId', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, generated_id, name, phone, type, kyc_status, bank_upi_id, avg_rating,
              is_available, created_at, current_lat, current_lng
       FROM service_providers WHERE generated_id = $1`,
      [req.params.generatedId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
