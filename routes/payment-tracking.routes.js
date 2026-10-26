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


// Consolidated admin ledger. Sources remain separate so the same booking cannot be
// counted twice and a subscription cycle is not treated as paid unless a payment record exists.
router.get('/records', async (req, res, next) => {
  try {
    await ensureSchema();
    // Keep this endpoint usable even before the wallet top-up screen has been opened
    // on a newly provisioned database.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_topup_requests (
        id BIGSERIAL PRIMARY KEY,
        customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        amount NUMERIC(12,2) NOT NULL CHECK (amount >= 50 AND amount <= 50000),
        utr VARCHAR(120) NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'pending_verification'
          CHECK (status IN ('pending_verification','verified','rejected')),
        bank_reference VARCHAR(120),
        admin_note TEXT,
        verified_by TEXT,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const requestedStatus = String(req.query.status || 'approved').trim().toLowerCase();
    const allowedStatuses = new Set(['approved', 'all', 'pending_verification', 'rejected', 'failed', 'refunded', 'payout_pending']);
    if (!allowedStatuses.has(requestedStatus)) return res.status(400).json({ error: 'Invalid payment status filter' });
    const search = String(req.query.search || '').trim().slice(0, 120);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '1000', 10) || 1000, 1), 2000);
    const result = await pool.query(
      `WITH records AS (
        SELECT
          'TOPUP-' || r.id::text AS record_id,
          'wallet_topup'::text AS source,
          'Wallet top-up'::text AS payment_type,
          'Customer → Gofixo'::text AS payment_flow,
          CASE WHEN r.status='verified' THEN 'approved' ELSE r.status END::text AS status,
          r.amount::numeric AS amount,
          'INR'::text AS currency,
          r.customer_id,
          c.name AS customer_name,
          c.phone AS customer_phone,
          NULL::integer AS provider_id,
          NULL::text AS provider_code,
          NULL::text AS provider_name,
          NULL::text AS provider_phone,
          'Customer wallet'::text AS professional_field,
          'UPI QR'::text AS payment_method,
          COALESCE(r.bank_reference, r.utr)::text AS reference,
          NULL::text AS plan_name,
          NULL::text AS cycle_start,
          NULL::text AS cycle_end,
          COALESCE(r.verified_at, r.created_at) AS occurred_at,
          to_char(COALESCE(r.verified_at, r.created_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS occurred_at_ist,
          r.admin_note AS notes
        FROM wallet_topup_requests r
        LEFT JOIN customers c ON c.id=r.customer_id

        UNION ALL

        SELECT
          'BOOKING-' || bt.booking_id::text,
          'booking',
          CASE WHEN b.service_type='ride' THEN 'Ride payment' ELSE 'Home service payment' END,
          CASE WHEN lower(COALESCE(bt.payment_method,''))='cash' THEN 'Customer → Partner' ELSE 'Customer → Gofixo wallet' END,
          CASE WHEN lower(COALESCE(bt.status,'')) IN ('paid','verified','success','completed') THEN 'approved' ELSE lower(COALESCE(bt.status,'pending_verification')) END,
          bt.gross_amount::numeric,
          'INR'::text,
          bt.customer_id,
          c.name,
          c.phone,
          bt.provider_id,
          sp.generated_id,
          sp.name,
          sp.phone,
          CASE
            WHEN b.service_type='ride' THEN initcap(replace(COALESCE(b.provider_type, sp.type, 'ride'), '_', ' '))
            ELSE initcap(replace(COALESCE(b.service_category, sp.service_categories[1], 'home service'), '_', ' '))
          END,
          COALESCE(bt.payment_method, 'unknown'),
          ('Booking #' || bt.booking_id::text),
          sub.plan_name,
          sub.cycle_start,
          sub.cycle_end,
          COALESCE(bt.paid_at, b.completed_at, b.created_at),
          to_char((COALESCE(bt.paid_at, b.completed_at, b.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS'),
          CASE WHEN b.service_type='services' THEN 'Home service paid through wallet' ELSE 'Ride settlement recorded against partner' END
        FROM booking_transactions bt
        JOIN bookings b ON b.id=bt.booking_id
        LEFT JOIN customers c ON c.id=bt.customer_id
        LEFT JOIN service_providers sp ON sp.id=bt.provider_id
        LEFT JOIN LATERAL (
          SELECT p.plan_name,
                 to_char((ps.start_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS cycle_start,
                 to_char((ps.expiry_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS cycle_end
          FROM provider_subscriptions ps
          JOIN subscription_plans p ON p.id=ps.plan_id
          WHERE ps.provider_id=bt.provider_id
            AND ps.start_date <= COALESCE(bt.paid_at, b.completed_at, NOW())
            AND ps.expiry_date > COALESCE(bt.paid_at, b.completed_at, NOW())
          ORDER BY ps.start_date DESC, ps.id DESC
          LIMIT 1
        ) sub ON TRUE

        UNION ALL

        SELECT
          'TRACK-' || t.id::text,
          'payment_tracking',
          initcap(replace(t.transaction_type, '_', ' ')),
          CASE WHEN t.direction='out' THEN 'Gofixo → Recipient' ELSE 'Payer → Gofixo' END,
          CASE WHEN lower(t.status) IN ('paid','verified') THEN 'approved' ELSE lower(t.status) END,
          t.amount::numeric,
          COALESCE(t.currency, 'INR'),
          t.customer_id,
          c.name,
          c.phone,
          t.provider_id,
          sp.generated_id,
          sp.name,
          sp.phone,
          CASE WHEN sp.type IS NULL THEN '—' ELSE initcap(replace(sp.type, '_', ' ')) END,
          t.payment_method,
          COALESCE(t.bank_reference, t.transaction_code),
          sub.plan_name,
          sub.cycle_start,
          sub.cycle_end,
          COALESCE(t.occurred_at, t.received_at, t.created_at),
          to_char(COALESCE(t.occurred_at, t.received_at, t.created_at) AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS'),
          t.notes
        FROM payment_tracking_transactions t
        LEFT JOIN customers c ON c.id=t.customer_id
        LEFT JOIN service_providers sp ON sp.id=t.provider_id
        LEFT JOIN LATERAL (
          SELECT p.plan_name,
                 to_char(ps.start_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS cycle_start,
                 to_char(ps.expiry_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS cycle_end
          FROM provider_subscriptions ps
          JOIN subscription_plans p ON p.id=ps.plan_id
          WHERE ps.provider_id=t.provider_id
            AND ps.start_date <= COALESCE(t.occurred_at, t.created_at)
            AND ps.expiry_date > COALESCE(t.occurred_at, t.created_at)
          ORDER BY ps.start_date DESC, ps.id DESC
          LIMIT 1
        ) sub ON TRUE
        WHERE t.booking_id IS NULL
           OR t.transaction_type NOT IN ('ride_fare', 'household_service')
      )
      SELECT * FROM records
      WHERE ($1='all' OR status=$1)
        AND (
          $2='' OR concat_ws(' ', record_id, payment_type, customer_name, customer_phone,
            provider_code, provider_name, provider_phone, professional_field, payment_method,
            reference, plan_name, notes) ILIKE '%' || $2 || '%'
        )
      ORDER BY occurred_at DESC NULLS LAST, record_id DESC
      LIMIT $3`,
      [requestedStatus, search, limit]
    );
    const transactions = result.rows;
    const approvedAmount = transactions
      .filter((row) => row.status === 'approved' && row.payment_flow !== 'Gofixo → Recipient')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    res.set('Cache-Control', 'no-store');
    res.json({
      timezone: 'Asia/Kolkata',
      status: requestedStatus,
      count: transactions.length,
      limit,
      approved_amount_inr: Number(approvedAmount.toFixed(2)),
      transactions,
    });
  } catch (err) { next(err); }
});

module.exports = router;
