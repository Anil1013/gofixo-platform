const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');

const router = express.Router();
let schemaPromise;

function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS provider_subscription_payments (
          id BIGSERIAL PRIMARY KEY,
          provider_id INTEGER NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
          plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
          plan_name VARCHAR(160) NOT NULL,
          amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
          earning_cap NUMERIC(12,2) NOT NULL,
          validity_days INTEGER NOT NULL CHECK (validity_days > 0),
          utr VARCHAR(120) NOT NULL,
          status VARCHAR(24) NOT NULL DEFAULT 'pending_verification'
            CHECK (status IN ('pending_verification','verified','rejected')),
          bank_reference VARCHAR(120),
          admin_note TEXT,
          verified_by TEXT,
          verified_at TIMESTAMPTZ,
          subscription_id INTEGER REFERENCES provider_subscriptions(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS provider_subscription_payment_utr_unique ON provider_subscription_payments (UPPER(BTRIM(utr)))`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS provider_subscription_payment_bank_ref_unique ON provider_subscription_payments (UPPER(BTRIM(bank_reference))) WHERE status='verified' AND bank_reference IS NOT NULL`);
      await pool.query(`CREATE INDEX IF NOT EXISTS provider_subscription_payment_provider_idx ON provider_subscription_payments (provider_id, created_at DESC)`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS provider_subscription_payment_audit (
          id BIGSERIAL PRIMARY KEY,
          request_id BIGINT NOT NULL REFERENCES provider_subscription_payments(id) ON DELETE CASCADE,
          action VARCHAR(32) NOT NULL,
          actor TEXT NOT NULL,
          details TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS wallet_payment_settings (
          id SMALLINT PRIMARY KEY CHECK (id=1),
          upi_id VARCHAR(200) NOT NULL DEFAULT '',
          payee_name VARCHAR(120) NOT NULL DEFAULT 'Gofixo',
          qr_image BYTEA,
          qr_mime_type VARCHAR(50),
          updated_by TEXT NOT NULL DEFAULT 'admin',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((err) => { schemaPromise = null; throw err; });
  }
  return schemaPromise;
}

function actorName(req) {
  return String(req.user?.email || req.user?.username || req.user?.id || 'admin').slice(0, 200);
}

// Public plan catalogue; the client filters it to the signed-in partner's type.
router.get('/plans', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM subscription_plans ORDER BY provider_type, fee');
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Only authenticated partners can see the official QR/payment instructions.
router.get('/payment-config', requireAuth(['provider']), async (_req, res, next) => {
  try {
    await ensureSchema();
    const saved = await pool.query('SELECT payee_name, qr_image, qr_mime_type FROM wallet_payment_settings WHERE id=1');
    const row = saved.rows[0];
    const envUrl = String(process.env.GOFIXO_UPI_QR_IMAGE_URL || '').trim();
    const imageBase64 = row?.qr_image ? Buffer.from(row.qr_image).toString('base64') : '';
    res.set('Cache-Control', 'no-store');
    res.json({
      configured: Boolean(imageBase64 || /^https:\/\//i.test(envUrl)),
      payeeName: String(row?.payee_name || process.env.GOFIXO_UPI_PAYEE_NAME || 'Gofixo'),
      qrImageBase64: imageBase64,
      qrImageMimeType: row?.qr_mime_type || '',
      qrImageUrl: imageBase64 ? '' : (/^https:\/\//i.test(envUrl) ? envUrl : ''),
      instructions: 'Pay the exact plan amount using the official Gofixo QR. Submit the UTR. Your plan starts only after the admin matches the payment with the bank statement.'
    });
  } catch (err) { next(err); }
});

// Submit a payment claim. This endpoint never activates a subscription.
router.post('/payment-requests', requireAuth(['provider']), async (req, res, next) => {
  const planId = Number(req.body?.plan_id);
  const utr = String(req.body?.utr || '').trim().replace(/\s+/g, '').toUpperCase();
  if (!Number.isSafeInteger(planId) || planId <= 0) return res.status(400).json({ error: 'Choose a valid subscription plan' });
  if (!/^[A-Z0-9-]{8,120}$/.test(utr)) return res.status(400).json({ error: 'Enter a valid UTR/reference (8–120 letters or numbers)' });
  const client = await pool.connect();
  try {
    await ensureSchema();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gofixo-provider-subscription:${req.user.id}`]);
    const plan = await client.query('SELECT * FROM subscription_plans WHERE id=$1', [planId]);
    if (!plan.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Plan not found' }); }
    const provider = await client.query('SELECT type FROM service_providers WHERE id=$1', [req.user.id]);
    if (!provider.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Partner not found' }); }
    if (provider.rows[0].type !== plan.rows[0].provider_type) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This plan is not available for your partner type' }); }
    const qr = await client.query('SELECT qr_image FROM wallet_payment_settings WHERE id=1');
    const envUrl = String(process.env.GOFIXO_UPI_QR_IMAGE_URL || '').trim();
    if (!(qr.rows[0]?.qr_image || /^https:\/\//i.test(envUrl))) {
      await client.query('ROLLBACK');
      return res.status(503).json({ error: 'Admin must configure the official Gofixo payment QR before partners can submit a subscription payment.' });
    }
    const p = plan.rows[0];
    const inserted = await client.query(
      `INSERT INTO provider_subscription_payments
        (provider_id, plan_id, plan_name, amount, earning_cap, validity_days, utr)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, plan_id, plan_name, amount, earning_cap, validity_days, utr, status, created_at`,
      [req.user.id, planId, p.plan_name, p.fee, p.earning_cap, p.validity_days, utr]
    );
    await client.query(
      `INSERT INTO provider_subscription_payment_audit (request_id, action, actor, details)
       VALUES ($1,'submitted',$2,'Partner submitted UTR; awaiting bank statement verification')`,
      [inserted.rows[0].id, String(req.user.id)]
    );
    await client.query('COMMIT');
    res.status(201).json({ request: inserted.rows[0], message: 'Payment claim submitted. Your plan will activate only after bank verification.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'This UTR has already been submitted.' });
    next(err);
  } finally { client.release(); }
});

router.get('/my-payment-requests', requireAuth(['provider']), async (req, res, next) => {
  try {
    await ensureSchema();
    const result = await pool.query(
      `SELECT id, plan_name, amount, utr, status, admin_note, created_at, verified_at
       FROM provider_subscription_payments WHERE provider_id=$1
       ORDER BY created_at DESC, id DESC LIMIT 30`,
      [req.user.id]
    );
    res.json({ requests: result.rows });
  } catch (err) { next(err); }
});

// Admin queue; verify against actual bank credit, never against the submitted UTR alone.
router.get('/admin/payment-requests', requireAdmin, async (req, res, next) => {
  try {
    await ensureSchema();
    const status = String(req.query.status || 'pending_verification');
    if (!['pending_verification','verified','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid request status' });
    const result = await pool.query(
      `SELECT r.*, p.name AS provider_name, p.phone AS provider_phone, p.generated_id
       FROM provider_subscription_payments r
       JOIN service_providers p ON p.id=r.provider_id
       WHERE r.status=$1 ORDER BY r.created_at ASC, r.id ASC LIMIT 250`,
      [status]
    );
    res.json({ requests: result.rows });
  } catch (err) { next(err); }
});

router.post('/admin/payment-requests/:id/verify', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const amount = Number(req.body?.verified_amount);
  const bankReference = String(req.body?.bank_reference || '').trim().slice(0,120);
  const note = String(req.body?.note || '').trim().slice(0,1000) || null;
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid request ID' });
  if (!Number.isFinite(amount) || amount <= 0 || !bankReference) return res.status(400).json({ error: 'Bank-confirmed amount and bank reference are required' });
  const client = await pool.connect();
  try {
    await ensureSchema();
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM provider_subscription_payments WHERE id=$1 FOR UPDATE', [id]);
    if (!found.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment request not found' }); }
    const payment = found.rows[0];
    if (payment.status !== 'pending_verification') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This request has already been processed' }); }
    if (Number(payment.amount) !== Number(amount.toFixed(2))) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Bank-confirmed amount does not match plan fee; no subscription activated' }); }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gofixo-provider-subscription:${payment.provider_id}`]);
    await client.query(
      `UPDATE provider_subscriptions SET status=CASE WHEN expiry_date <= NOW() THEN 'expired' ELSE 'exhausted' END
       WHERE provider_id=$1 AND status='active'`,
      [payment.provider_id]
    );
    const activated = await client.query(
      `INSERT INTO provider_subscriptions (provider_id, plan_id, expiry_date, total_earned_this_cycle, status)
       VALUES ($1,$2,NOW() + ($3::text || ' days')::interval,0,'active') RETURNING id, start_date, expiry_date, status`,
      [payment.provider_id, payment.plan_id, payment.validity_days]
    );
    const updated = await client.query(
      `UPDATE provider_subscription_payments SET status='verified', bank_reference=$1, admin_note=$2,
       verified_by=$3, verified_at=NOW(), subscription_id=$4, updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [bankReference, note, actorName(req), activated.rows[0].id, id]
    );
    await client.query(
      `INSERT INTO provider_subscription_payment_audit (request_id, action, actor, details)
       VALUES ($1,'verified_and_activated',$2,$3)`,
      [id, actorName(req), 'Bank amount matched; subscription #' + activated.rows[0].id + ' activated']
    );
    await client.query('COMMIT');
    res.json({ request: updated.rows[0], subscription: activated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'This bank reference has already been used; no subscription activated' });
    next(err);
  } finally { client.release(); }
});

router.post('/admin/payment-requests/:id/reject', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const note = String(req.body?.note || '').trim().slice(0,1000);
  if (!Number.isSafeInteger(id) || id <= 0 || !note) return res.status(400).json({ error: 'A valid request ID and rejection reason are required' });
  try {
    await ensureSchema();
    const result = await pool.query(
      `UPDATE provider_subscription_payments SET status='rejected', admin_note=$1, verified_by=$2,
       verified_at=NOW(), updated_at=NOW()
       WHERE id=$3 AND status='pending_verification' RETURNING id, status`,
      [note, actorName(req), id]
    );
    if (!result.rows.length) return res.status(409).json({ error: 'Request not found or already processed' });
    await pool.query(
      `INSERT INTO provider_subscription_payment_audit (request_id, action, actor, details)
       VALUES ($1,'rejected',$2,$3)`,
      [id, actorName(req), note]
    );
    res.json({ request: result.rows[0] });
  } catch (err) { next(err); }
});

// Legacy direct activation is deliberately disabled. Payment verification is mandatory.
router.post('/subscribe', requireAuth(['provider']), (_req, res) => {
  res.status(410).json({ error: 'Direct activation is disabled. Submit payment proof and wait for admin bank verification.' });
});

// Own subscription status only.
router.get('/status/:providerId', requireAuth(['provider']), async (req, res, next) => {
  try {
    if (Number(req.params.providerId) !== Number(req.user.id)) return res.status(403).json({ error: 'You can only view your own subscription status' });
    await pool.query(`UPDATE provider_subscriptions SET status='expired' WHERE provider_id=$1 AND status='active' AND expiry_date<=NOW()`, [req.params.providerId]);
    const result = await pool.query(
      `SELECT ps.*, sp.fee, sp.earning_cap, sp.plan_name FROM provider_subscriptions ps
       JOIN subscription_plans sp ON ps.plan_id=sp.id WHERE ps.provider_id=$1
       ORDER BY ps.start_date DESC LIMIT 1`,
      [req.params.providerId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No subscription found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
