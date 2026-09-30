const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { promises: fsp } = fs;
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { isValidPassword, PASSWORD_ERROR } = require('../utils/password');
const { getVapidPublicKey } = require('../services/push');
const { broadcastProviderLocation } = require('../services/realtime');

const PROVIDER_TYPES = ['bike', 'auto', 'car', 'general_worker', 'skilled_worker'];

const DOC_LABELS = {
  aadhar_front: 'Aadhar card (front)',
  aadhar_back: 'Aadhar card (back)',
  driving_license: 'Driving license',
  vehicle_rc: 'Vehicle RC',
  vehicle_photo_front: 'Vehicle photo (front)',
  vehicle_photo_back: 'Vehicle photo (back)',
  profile_photo: 'Profile photo',
  police_verification: 'Police verification',
};

const ALLOWED_DOCUMENT_TYPES = new Set([
  'aadhar_front', 'aadhar_back', 'driving_license', 'vehicle_rc',
  'vehicle_photo_front', 'vehicle_photo_back', 'profile_photo', 'police_verification',
]);
const ALLOWED_UPLOAD_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);

const upload = multer({
  // Keep the upload in memory until authentication, ownership, and doc_type validation pass.
  // This prevents unauthorized requests from writing files to another provider's directory.
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1,
    fields: 2,
    parts: 3,
    fieldNameSize: 100,
    fieldSize: 200,
  },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
      return cb(Object.assign(new Error('Only JPG, PNG, WEBP, and PDF files are allowed'), { status: 400 }));
    }

    // Some Android file pickers report application/octet-stream (or an empty MIME)
    // even when the filename has a valid image/PDF extension. Do not reject those
    // valid files solely because the picker supplied a generic MIME.
    const mimeAllowed =
      !file.mimetype ||
      file.mimetype === 'application/octet-stream' ||
      ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype);

    if (!mimeAllowed) {
      return cb(Object.assign(new Error('Only JPG, PNG, WEBP, and PDF files are allowed'), { status: 400 }));
    }

    cb(null, true);
  },
});

function requireOwnProvider(req, res, next) {
  if (req.user.id !== parseInt(req.params.id, 10)) {
    return res.status(403).json({ error: 'You can only access your own provider account' });
  }
  next();
}

// Register a new provider (driver/worker) — KYC starts as 'pending'
router.post('/register', async (req, res, next) => {
  try {
    const { name, phone, type, password } = req.body;
    const normalizedPhone = String(phone ?? '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (!name || !normalizedPhone || !type || !password) {
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
        [generatedId, name, normalizedPhone, type, passwordHash]
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
      SELECT sp.id, sp.generated_id, sp.name, sp.phone, sp.type, sp.kyc_status, sp.kyc_review_note, sp.bank_upi_id,
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
        SELECT json_agg(json_build_object('id', id, 'doc_type', doc_type) ORDER BY uploaded_at DESC) AS documents
        FROM provider_documents pd WHERE pd.provider_id = sp.id
      ) docs ON true
      ORDER BY sp.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Admin-only access to a stored KYC document. Documents are never publicly served.
router.get('/admin/:id/documents/:documentId', requireAdmin, async (req, res, next) => {
  try {
    const providerId = parseInt(req.params.id, 10);
    const documentId = parseInt(req.params.documentId, 10);
    if (!Number.isInteger(providerId) || !Number.isInteger(documentId)) {
      return res.status(400).json({ error: 'Invalid provider or document ID' });
    }
    const result = await pool.query(
      'SELECT file_url FROM provider_documents WHERE id = $1 AND provider_id = $2',
      [documentId, providerId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

    const relativePath = result.rows[0].file_url.replace(/^\/uploads\//, '');
    const filePath = path.resolve(__dirname, '..', 'uploads', relativePath);
    const uploadsRoot = path.resolve(__dirname, '..', 'uploads') + path.sep;
    if (!filePath.startsWith(uploadsRoot)) return res.status(400).json({ error: 'Invalid document path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Document file not found' });

    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

// Authenticated provider access to a stored KYC document.
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

    const relativePath = result.rows[0].file_url.replace(/^\/uploads\//, '');
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
router.post('/:id/documents', requireAuth(['provider']), requireOwnProvider, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const docType = req.body.doc_type;
    if (!ALLOWED_DOCUMENT_TYPES.has(docType)) {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    const dir = path.join(__dirname, '..', 'uploads', 'providers', String(req.params.id));
    await fsp.mkdir(dir, { recursive: true });
    const extension = path.extname(req.file.originalname || '').toLowerCase();
    const filename = `${docType}-${crypto.randomBytes(16).toString('hex')}${extension}`;
    const filePath = path.join(dir, filename);
    await fsp.writeFile(filePath, req.file.buffer, { flag: 'wx' });

    const fileUrl = `/uploads/providers/${req.params.id}/${filename}`;
    try {
      const result = await pool.query(
        'INSERT INTO provider_documents (provider_id, doc_type, file_url) VALUES ($1, $2, $3) RETURNING id, provider_id, doc_type, file_url, uploaded_at',
        [req.params.id, docType, fileUrl]
      );

      // Admin approval is final: provider document uploads must never revoke an
      // already-approved KYC status. Profile-photo replacement is also independent
      // of KYC, so an approved provider can change it whenever they want.
      const provider = await pool.query(
        'SELECT type, kyc_status FROM service_providers WHERE id = $1',
        [req.params.id]
      );

      if (provider.rows.length > 0) {
        const currentStatus = provider.rows[0].kyc_status;

        if (docType !== 'profile_photo' && currentStatus !== 'approved') {
          // A corrected KYC document clears the previous review note and returns
          // the provider to pending until all required documents are present.
          await pool.query(
            'UPDATE service_providers SET kyc_status = \'pending\', kyc_review_note = NULL WHERE id = $1',
            [req.params.id]
          );

          // Auto-approve when all required documents for this provider type
          // are present. This is a completeness/file-validation rule; admin
          // approval remains the final override.
          const required = REQUIRED_DOCS[provider.rows[0].type] || [];
          const docs = await pool.query(
            'SELECT DISTINCT doc_type FROM provider_documents WHERE provider_id = $1',
            [req.params.id]
          );
          const uploaded = new Set(docs.rows.map((d) => d.doc_type));
          if (required.length > 0 && required.every((doc) => uploaded.has(doc))) {
            await pool.query(
              'UPDATE service_providers SET kyc_status = \'approved\', kyc_review_note = NULL WHERE id = $1',
              [req.params.id]
            );
          }
        }
      }

      res.status(201).json(result.rows[0]);
    } catch (err) {
      await fsp.unlink(filePath).catch(() => {});
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

const REQUIRED_DOCS = {
  bike: ['aadhar_front', 'aadhar_back', 'driving_license', 'vehicle_rc', 'vehicle_photo_front', 'vehicle_photo_back'],
  car: ['aadhar_front', 'aadhar_back', 'driving_license', 'vehicle_rc', 'vehicle_photo_front', 'vehicle_photo_back'],
  auto: ['aadhar_front', 'aadhar_back', 'driving_license', 'vehicle_rc', 'vehicle_photo_front', 'vehicle_photo_back'],
  general_worker: ['aadhar_front', 'aadhar_back', 'profile_photo', 'police_verification'],
  skilled_worker: ['aadhar_front', 'aadhar_back', 'profile_photo', 'police_verification'],
};

// Update KYC status (admin approve/reject)
router.patch('/:id/kyc', requireAdmin, async (req, res, next) => {
  try {
    const providerId = parseInt(req.params.id, 10);
    const { status } = req.body;
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

    if (!Number.isInteger(providerId)) {
      return res.status(400).json({ error: 'Invalid provider ID' });
    }
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved, rejected, or pending' });
    }
    if (reason.length > 500) {
      return res.status(400).json({ error: 'Review reason must be 500 characters or less' });
    }

    const provider = await pool.query(
      'SELECT id, generated_id, name, phone, type, kyc_status FROM service_providers WHERE id = $1',
      [providerId]
    );
    if (provider.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });

    let reviewNote = reason || null;

    if (status === 'approved') {
      // Admin approval is the final authority. Do not block it because a
      // provider is missing a document; the admin has explicitly reviewed
      // and approved this account.
      reviewNote = null;
    } else if (status === 'rejected' && !reviewNote) {
      reviewNote = 'KYC rejected by admin. Please review your documents and upload corrected documents.';
    }

    const result = await pool.query(
      'UPDATE service_providers SET kyc_status = $1, kyc_review_note = $2 WHERE id = $3 RETURNING id, generated_id, name, phone, type, kyc_status, kyc_review_note, avg_rating, is_available, created_at',
      [status, reviewNote, providerId]
    );

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
        `SELECT sp.kyc_status, sp.current_lat, sp.current_lng, sp.location_updated_at,
                ps.status, ps.expiry_date
         FROM service_providers sp
         LEFT JOIN provider_subscriptions ps
           ON ps.provider_id = sp.id
          AND ps.status = 'active'
          AND ps.expiry_date > NOW()
         WHERE sp.id = $1
         ORDER BY ps.start_date DESC NULLS LAST
         LIMIT 1`,
        [req.params.id]
      );
      if (sub.rows.length === 0) {
        return res.status(404).json({ error: 'Provider not found' });
      }
      if (sub.rows[0].kyc_status !== 'approved') {
        return res.status(403).json({ error: 'KYC approval is required before going available' });
      }
      if (!sub.rows[0].status || !sub.rows[0].expiry_date) {
        return res.status(403).json({ error: 'No active subscription — renew your plan to go available' });
      }
      if (sub.rows[0].current_lat === null || sub.rows[0].current_lng === null || !sub.rows[0].location_updated_at) {
        return res.status(400).json({ error: 'Share your current location before going available' });
      }
      if (new Date(sub.rows[0].location_updated_at).getTime() <= Date.now() - 5 * 60 * 1000) {
        return res.status(400).json({ error: 'Your location is stale. Update your current location before going available.' });
      }
    }

    let result;
    if (is_available) {
      // Atomically refuse to go online while this provider already owns
      // an active booking. This closes the check-then-update race.
      result = await pool.query(
        `UPDATE service_providers
         SET is_available = true
         WHERE id = $1
           AND NOT EXISTS (
             SELECT 1 FROM bookings b
             WHERE b.provider_id = service_providers.id
               AND b.status IN ('requested', 'accepted', 'ongoing')
           )
         RETURNING id, generated_id, name, phone, type, kyc_status, avg_rating, is_available, current_lat, current_lng, location_updated_at`,
        [req.params.id]
      );
      if (result.rows.length === 0) {
        const provider = await pool.query(
          'SELECT id FROM service_providers WHERE id = $1',
          [req.params.id]
        );
        if (provider.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
        return res.status(409).json({ error: 'Finish the current booking before going available' });
      }
    } else {
      result = await pool.query(
        'UPDATE service_providers SET is_available = false WHERE id = $1 RETURNING id, generated_id, name, phone, type, kyc_status, avg_rating, is_available, current_lat, current_lng, location_updated_at',
        [req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Browser push setup for background/locked-screen provider alerts.
router.get('/push/public-key', requireAuth(['provider']), async (req, res) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) return res.status(503).json({ error: 'Background notifications are not configured' });
  res.json({ public_key: publicKey });
});

router.post('/push-subscription', requireAuth(['provider']), async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (
      typeof endpoint !== 'string' ||
      !endpoint.startsWith('https://') ||
      !keys ||
      typeof keys.p256dh !== 'string' ||
      typeof keys.auth !== 'string'
    ) {
      return res.status(400).json({ error: 'Invalid push subscription' });
    }

    await pool.query(
      `INSERT INTO provider_push_subscriptions (provider_id, endpoint, p256dh, auth, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (provider_id, endpoint)
       DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = NOW()`,
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    );
    res.status(201).json({ subscribed: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/push-subscription', requireAuth(['provider']), async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (typeof endpoint !== 'string') return res.status(400).json({ error: 'endpoint is required' });
    await pool.query(
      'DELETE FROM provider_push_subscriptions WHERE provider_id = $1 AND endpoint = $2',
      [req.user.id, endpoint]
    );
    res.json({ subscribed: false });
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
      'UPDATE service_providers SET current_lat = $1, current_lng = $2, location_updated_at = NOW() WHERE id = $3 RETURNING id, generated_id, name, type, kyc_status, is_available, current_lat, current_lng, location_updated_at',
      [latitude, longitude, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Provider not found' });

    // Push the newest GPS position to customers who are tracking this provider.
    broadcastProviderLocation(
      Number(req.params.id),
      latitude,
      longitude,
      result.rows[0].location_updated_at
    ).catch((err) => console.error('Realtime location broadcast error:', err.message));

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth(['provider']), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT sp.id, sp.generated_id, sp.name, sp.phone, sp.type, sp.kyc_status, sp.kyc_review_note,
        sp.bank_upi_id, sp.avg_rating, sp.is_available, sp.current_lat, sp.current_lng,
        sp.location_updated_at, sp.created_at,
        (
          SELECT COUNT(*)
          FROM bookings b
          WHERE b.provider_id = sp.id
            AND b.status = 'completed'
            AND COALESCE(b.completed_at, b.created_at) >= CURRENT_DATE
        ) AS today_rides,
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
        SELECT json_agg(json_build_object('id', id, 'doc_type', doc_type) ORDER BY uploaded_at DESC) AS documents
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
      `SELECT generated_id, name, type, kyc_status, avg_rating
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
