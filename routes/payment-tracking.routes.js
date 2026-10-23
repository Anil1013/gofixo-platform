const express = require('express');
const crypto = require('crypto');
const pool = require('../config/db');
const { requireAdmin } = require('../middleware/admin');

const router = express.Router();
router.use(requireAdmin);

const TYPES = new Set(['ride_subscription', 'ride_fare', 'household_service', 'partner_payout', 'refund', 'other']);
const DIRECTIONS = new Set(['in', 'out']);
const STATUSES = new Set(['pending_verification', 'verified', 'payout_pending', 'paid', 'failed', 'refunded']);

let schemaPromise;
function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS payment_tracking_transactions (
          id BIGSERIAL PRIMARY KEY,
          transaction_code VARCHAR(40) NOT NULL UNIQUE,
          direction VARCHAR(8) NOT NULL CHECK (direction IN ('in','out')),
          transaction_type VARCHAR(32) NOT NULL,
          amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
          currency VARCHAR(3) NOT NULL DEFAULT 'INR',
          status VARCHAR(24) NOT NULL DEFAULT 'pending_verification',
          booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
          customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
          provider_id INTEGER REFERENCES service_providers(id) ON DELETE SET NULL,
          payment_method VARCHAR(32) NOT NULL DEFAULT 'upi_qr',
          bank_reference VARCHAR(120),
          occurred_at TIMESTAMPTZ,
          received_at TIMESTAMPTZ,
          verified_at TIMESTAMPTZ,
          verified_by TEXT,
          notes TEXT,
          created_by TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS payment_tracking_created_idx ON payment_tracking_transactions (created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS payment_tracking_booking_idx ON payment_tracking_transactions (booking_id, created_at DESC)`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS payment_tracking_audit (
          id BIGSERIAL PRIMARY KEY,
          transaction_id BIGINT NOT NULL REFERENCES payment_tracking_transactions(id) ON DELETE CASCADE,
          action VARCHAR(32) NOT NULL,
          old_status VARCHAR(24),
          new_status VARCHAR(24),
          actor TEXT NOT NULL,
          details TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((err) => { schemaPromise = null; throw err; });
  }
  return schemaPromise;
}

function getActor(req) {
  return String(req.user?.email || req.user?.username || req.user?.id || 'admin').slice(0, 200);
}

router.get('/transactions', async (req, res, next) => {
  try {
    await ensureSchema();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '100', 10) || 100, 1), 250);
    const status = String(req.query.status || '').trim();
    const direction = String(req.query.direction || '').trim();
    const params = [];
    const where = [];
    if (status) {
      if (!STATUSES.has(status)) return res.status(400).json({ error: 'Invalid transaction status' });
      params.push(status); where.push(`t.status = $${params.length}`);
    }
    if (direction) {
      if (!DIRECTIONS.has(direction)) return res.status(400).json({ error: 'Invalid transaction direction' });
      params.push(direction); where.push(`t.direction = $${params.length}`);
    }
    params.push(limit);
    const result = await pool.query(
      `SELECT t.*,
              to_char(t.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS created_at_ist,
              to_char(t.occurred_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS occurred_at_ist,
              to_char(t.received_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS received_at_ist,
              to_char(t.verified_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS verified_at_ist,
              c.name AS customer_name, sp.name AS provider_name
       FROM payment_tracking_transactions t
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN service_providers sp ON sp.id = t.provider_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length}`,
      params
    );
    res.json({ timezone: 'Asia/Kolkata', transactions: result.rows });
  } catch (err) { next(err); }
});

router.post('/transactions', async (req, res, next) => {
  try {
    await ensureSchema();
    const direction = String(req.body?.direction || '').trim();
    const transactionType = String(req.body?.transaction_type || 'other').trim();
    const amount = Number(req.body?.amount);
    const status = String(req.body?.status || 'pending_verification').trim();
    const bookingId = req.body?.booking_id == null || req.body.booking_id === '' ? null : Number(req.body.booking_id);
    const customerId = req.body?.customer_id == null || req.body.customer_id === '' ? null : Number(req.body.customer_id);
    const providerId = req.body?.provider_id == null || req.body.provider_id === '' ? null : Number(req.body.provider_id);
    const reference = String(req.body?.bank_reference || '').trim().slice(0, 120) || null;
    const notes = String(req.body?.notes || '').trim().slice(0, 2000) || null;
    const method = String(req.body?.payment_method || 'upi_qr').trim().slice(0, 32);
    const occurredAt = req.body?.occurred_at ? new Date(req.body.occurred_at) : null;
    if (!DIRECTIONS.has(direction)) return res.status(400).json({ error: 'direction must be in or out' });
    if (!TYPES.has(transactionType)) return res.status(400).json({ error: 'Invalid transaction_type' });
    if (!STATUSES.has(status)) return res.status(400).json({ error: 'Invalid transaction status' });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) return res.status(400).json({ error: 'amount must be between ₹0.01 and ₹10000000' });
    if (occurredAt && Number.isNaN(occurredAt.getTime())) return res.status(400).json({ error: 'occurred_at must be a valid ISO date/time with timezone' });
    for (const [name, value] of [['booking_id', bookingId], ['customer_id', customerId], ['provider_id', providerId]]) {
      if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) return res.status(400).json({ error: name + ' must be a positive integer' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const code = 'GFX-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const actor = getActor(req);
      const verified = status === 'verified' || status === 'paid';
      const result = await client.query(
        `INSERT INTO payment_tracking_transactions
          (transaction_code, direction, transaction_type, amount, status, booking_id, customer_id, provider_id,
           payment_method, bank_reference, occurred_at, received_at, verified_at, verified_by, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                 CASE WHEN $2 = 'in' AND $12 THEN NOW() ELSE NULL END,
                 CASE WHEN $12 THEN NOW() ELSE NULL END,
                 CASE WHEN $12 THEN $13 ELSE NULL END,$14,$13)
         RETURNING *`,
        [code, direction, transactionType, Number(amount.toFixed(2)), status, bookingId, customerId, providerId,
         method, reference, occurredAt, verified, actor, notes]
      );
      await client.query(
        `INSERT INTO payment_tracking_audit (transaction_id, action, new_status, actor, details)
         VALUES ($1, 'created', $2, $3, $4)`,
        [result.rows[0].id, status, actor, notes]
      );
      await client.query('COMMIT');
      res.status(201).json({ transaction: result.rows[0], timezone: 'Asia/Kolkata' });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

router.patch('/transactions/:id/status', async (req, res, next) => {
  try {
    await ensureSchema();
    const id = Number(req.params.id);
    const status = String(req.body?.status || '').trim();
    const reference = String(req.body?.bank_reference || '').trim().slice(0, 120) || null;
    const notes = String(req.body?.notes || '').trim().slice(0, 2000) || null;
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid transaction ID' });
    if (!STATUSES.has(status)) return res.status(400).json({ error: 'Invalid transaction status' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM payment_tracking_transactions WHERE id=$1 FOR UPDATE', [id]);
      if (!current.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Transaction not found' });
      }
      const old = current.rows[0];
      if (old.status === 'paid' && status !== 'paid' && status !== 'refunded') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Paid transaction can only remain paid or be marked refunded' });
      }
      const actor = getActor(req);
      const verified = status === 'verified' || status === 'paid';
      const updated = await client.query(
        `UPDATE payment_tracking_transactions
         SET status=$1,
             bank_reference=COALESCE($2, bank_reference),
             notes=COALESCE($3, notes),
             received_at=CASE WHEN $1='verified' AND direction='in' THEN COALESCE(received_at,NOW()) ELSE received_at END,
             verified_at=CASE WHEN $4 THEN NOW() ELSE verified_at END,
             verified_by=CASE WHEN $4 THEN $5 ELSE verified_by END,
             updated_at=NOW()
         WHERE id=$6 RETURNING *`,
        [status, reference, notes, verified, actor, id]
      );
      await client.query(
        `INSERT INTO payment_tracking_audit (transaction_id, action, old_status, new_status, actor, details)
         VALUES ($1, 'status_changed', $2, $3, $4, $5)`,
        [id, old.status, status, actor, notes || reference]
      );
      await client.query('COMMIT');
      res.json({ transaction: updated.rows[0], timezone: 'Asia/Kolkata' });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

router.get('/transactions/:id/audit', async (req, res, next) => {
  try {
    await ensureSchema();
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid transaction ID' });
    const result = await pool.query(
      `SELECT id, transaction_id, action, old_status, new_status, actor, details,
              to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS created_at_ist
       FROM payment_tracking_audit WHERE transaction_id=$1 ORDER BY created_at ASC, id ASC`,
      [id]
    );
    res.json({ timezone: 'Asia/Kolkata', audit: result.rows });
  } catch (err) { next(err); }
});

module.exports = router;
