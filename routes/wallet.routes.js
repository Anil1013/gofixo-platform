const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');

const router = express.Router();

async function ensureTopupSchema() {
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
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_topup_utr_unique
    ON wallet_topup_requests (UPPER(BTRIM(utr)))
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS wallet_topup_customer_idx
    ON wallet_topup_requests (customer_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallet_topup_audit (
      id BIGSERIAL PRIMARY KEY,
      request_id BIGINT NOT NULL REFERENCES wallet_topup_requests(id) ON DELETE CASCADE,
      action VARCHAR(32) NOT NULL,
      actor TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureWallet(client, customerId) {
  await client.query(
    'INSERT INTO wallets (customer_id) VALUES ($1) ON CONFLICT (customer_id) DO NOTHING',
    [customerId]
  );
  const result = await client.query(
    'SELECT * FROM wallets WHERE customer_id = $1 FOR UPDATE',
    [customerId]
  );
  return result.rows[0];
}

function actorName(req) {
  return String(req.user?.email || req.user?.username || req.user?.id || 'admin').slice(0, 200);
}

// Public configuration for the authenticated customer QR payment screen.
// Configure these values in the backend environment; never hard-code account data in the app.
router.get('/topup-config', requireAuth(['customer']), async (_req, res, next) => {
  try {
    await ensureTopupSchema();
    const upiId = String(process.env.GOFIXO_UPI_ID || '').trim();
    const payeeName = String(process.env.GOFIXO_UPI_PAYEE_NAME || 'Gofixo').trim();
    const qrImageUrl = String(process.env.GOFIXO_UPI_QR_IMAGE_URL || '').trim();
    res.set('Cache-Control', 'no-store');
    res.json({
      configured: Boolean(upiId && qrImageUrl),
      paymentMethod: 'upi_qr',
      upiId,
      payeeName,
      qrImageUrl,
      minAmount: 50,
      maxAmount: 50000,
      currency: 'INR',
      instructions: 'Pay using the official QR, then submit the UTR. Wallet credit happens only after an admin matches the payment with the bank record.'
    });
  } catch (err) { next(err); }
});

// Customer submits a payment claim. This endpoint NEVER credits the wallet.
router.post('/topup-intent', requireAuth(['customer']), async (req, res, next) => {
  const amount = Number(req.body?.amount);
  const utr = String(req.body?.utr || '').trim().replace(/\s+/g, '').slice(0, 120);
  if (!Number.isFinite(amount) || amount < 50 || amount > 50000) {
    return res.status(400).json({ error: 'Amount must be between ₹50 and ₹50,000' });
  }
  if (!/^([A-Za-z0-9-]{8,120})$/.test(utr)) {
    return res.status(400).json({ error: 'Enter a valid UTR/reference (8–120 letters or numbers)' });
  }
  try {
    await ensureTopupSchema();
    const result = await pool.query(
      `INSERT INTO wallet_topup_requests (customer_id, amount, utr)
       VALUES ($1, $2, $3)
       RETURNING id, amount, utr, status, created_at,
         to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS created_at_ist`,
      [req.user.id, Number(amount.toFixed(2)), utr]
    );
    await pool.query(
      `INSERT INTO wallet_topup_audit (request_id, action, actor, details)
       VALUES ($1, 'submitted', $2, $3)`,
      [result.rows[0].id, String(req.user.id), 'Customer submitted UTR; pending bank-record verification']
    );
    return res.status(201).json({
      request: result.rows[0],
      message: 'Payment claim submitted. Wallet balance will change only after bank verification.'
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This UTR has already been submitted. Contact support if you believe this is an error.' });
    next(err);
  }
});

router.get('/topup-requests', requireAuth(['customer']), async (req, res, next) => {
  try {
    await ensureTopupSchema();
    const result = await pool.query(
      `SELECT id, amount, utr, status, bank_reference, admin_note,
              to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS created_at_ist,
              to_char(verified_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS verified_at_ist
       FROM wallet_topup_requests WHERE customer_id=$1
       ORDER BY created_at DESC, id DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ timezone: 'Asia/Kolkata', requests: result.rows });
  } catch (err) { next(err); }
});

// Admin-only queue of customer UTR claims awaiting bank statement matching.
router.get('/admin/topups', requireAdmin, async (req, res, next) => {
  try {
    await ensureTopupSchema();
    const status = String(req.query.status || 'pending_verification');
    if (!['pending_verification', 'verified', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid top-up status' });
    }
    const result = await pool.query(
      `SELECT r.id, r.customer_id, c.name AS customer_name, c.phone,
              r.amount, r.utr, r.status, r.bank_reference, r.admin_note,
              r.created_at, r.verified_at, r.verified_by,
              to_char(r.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS created_at_ist,
              to_char(r.verified_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS verified_at_ist
       FROM wallet_topup_requests r JOIN customers c ON c.id=r.customer_id
       WHERE r.status=$1 ORDER BY r.created_at ASC, r.id ASC LIMIT 250`,
      [status]
    );
    res.json({ timezone: 'Asia/Kolkata', requests: result.rows });
  } catch (err) { next(err); }
});

// Verify against the actual bank record. Amount must match exactly; credit and audit are atomic.
router.post('/admin/topups/:id/verify', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const bankReference = String(req.body?.bank_reference || '').trim().slice(0, 120);
  const verifiedAmount = Number(req.body?.verified_amount);
  const note = String(req.body?.note || '').trim().slice(0, 1000) || null;
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid top-up request ID' });
  if (!bankReference) return res.status(400).json({ error: 'Bank reference is required for verification' });
  if (!Number.isFinite(verifiedAmount) || verifiedAmount <= 0) return res.status(400).json({ error: 'A valid bank-confirmed amount is required' });

  const client = await pool.connect();
  try {
    await ensureTopupSchema();
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM wallet_topup_requests WHERE id=$1 FOR UPDATE', [id]);
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Top-up request not found' });
    }
    const request = found.rows[0];
    if (request.status !== 'pending_verification') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This request has already been processed' });
    }
    if (Number(request.amount) !== Number(verifiedAmount.toFixed(2))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Bank-confirmed amount does not match the submitted amount; no wallet credit was made' });
    }

    const wallet = await ensureWallet(client, request.customer_id);
    const before = Number(wallet.available_balance);
    const after = Number((before + Number(request.amount)).toFixed(2));
    await client.query(
      'UPDATE wallets SET available_balance=$1, updated_at=NOW() WHERE id=$2',
      [after, wallet.id]
    );
    await client.query(
      `INSERT INTO wallet_transactions
       (wallet_id, customer_id, type, amount, balance_before, balance_after, reserved_before, reserved_after,
        status, reference_id, metadata)
       VALUES ($1,$2,'TOPUP',$3,$4,$5,$6,$6,'completed',$7,$8::jsonb)`,
      [wallet.id, request.customer_id, request.amount, before, after, wallet.reserved_balance,
       'manual-upi-topup:' + request.id,
       JSON.stringify({ topup_request_id: request.id, utr: request.utr, bank_reference: bankReference, verified_by: actorName(req) })]
    );
    const updated = await client.query(
      `UPDATE wallet_topup_requests
       SET status='verified', bank_reference=$1, admin_note=$2, verified_by=$3, verified_at=NOW(), updated_at=NOW()
       WHERE id=$4 RETURNING id, customer_id, amount, utr, status, bank_reference, verified_by, verified_at`,
      [bankReference, note, actorName(req), id]
    );
    await client.query(
      `INSERT INTO wallet_topup_audit (request_id, action, actor, details)
       VALUES ($1, 'verified_and_credited', $2, $3)`,
      [id, actorName(req), 'Bank-confirmed amount matched; wallet credited ₹' + Number(request.amount).toFixed(2)]
    );
    await client.query('COMMIT');
    return res.json({ request: updated.rows[0], credited_amount: Number(request.amount), available_balance: after, timezone: 'Asia/Kolkata' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'This top-up was already credited; no duplicate credit was made' });
    next(err);
  } finally { client.release(); }
});

router.post('/admin/topups/:id/reject', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid top-up request ID' });
  if (!note) return res.status(400).json({ error: 'A rejection reason is required' });
  const client = await pool.connect();
  try {
    await ensureTopupSchema();
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE wallet_topup_requests SET status='rejected', admin_note=$1, verified_by=$2,
         verified_at=NOW(), updated_at=NOW()
       WHERE id=$3 AND status='pending_verification' RETURNING id, customer_id, amount, utr, status`,
      [note, actorName(req), id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Request not found or already processed' });
    }
    await client.query(
      `INSERT INTO wallet_topup_audit (request_id, action, actor, details)
       VALUES ($1, 'rejected', $2, $3)`,
      [id, actorName(req), note]
    );
    await client.query('COMMIT');
    return res.json({ request: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally { client.release(); }
});

router.get('/', requireAuth(['customer']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wallet = await ensureWallet(client, req.user.id);
    await client.query('COMMIT');
    res.json({
      id: wallet.id,
      customer_id: wallet.customer_id,
      available_balance: Number(wallet.available_balance),
      reserved_balance: Number(wallet.reserved_balance),
      currency: wallet.currency,
      status: wallet.status
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.get('/transactions', requireAuth(['customer']), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT wt.id, wt.booking_id, wt.type, wt.amount, wt.balance_before, wt.balance_after,
              wt.reserved_before, wt.reserved_after, wt.status, wt.reference_id,
              wt.created_at,
              to_char(wt.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS created_at_ist
       FROM wallet_transactions wt
       JOIN wallets w ON w.id = wt.wallet_id
       WHERE wt.customer_id = $1
       ORDER BY wt.created_at DESC, wt.id DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
