const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

const CASHFREE_API_VERSION = '2025-01-01';

function asMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1000000) return null;
  return Number(n.toFixed(2));
}

function cashfreeConfigured() {
  return Boolean(process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_SECRET);
}

function cashfreeBaseUrl() {
  return String(process.env.CASHFREE_ENV || 'sandbox').toLowerCase() === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

async function cashfreeRequest(path, method, body) {
  if (!cashfreeConfigured()) {
    const error = new Error('Cashfree payment gateway is not configured');
    error.status = 503;
    throw error;
  }

  const response = await fetch(cashfreeBaseUrl() + path, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-version': CASHFREE_API_VERSION,
      'x-client-id': process.env.CASHFREE_CLIENT_ID,
      'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || 'Cashfree request failed');
    error.status = response.status >= 500 ? 502 : 400;
    throw error;
  }
  return data;
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
              wt.reserved_before, wt.reserved_after, wt.status, wt.reference_id, wt.created_at
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

// Creates a Cashfree order. The wallet is NOT credited here.
// Only the verified Cashfree webhook can turn the pending TOPUP into available money.
router.post('/topup-intent', requireAuth(['customer']), async (req, res, next) => {
  const amount = asMoney(req.body?.amount);
  if (amount === null) {
    return res.status(400).json({ error: 'amount must be between ₹0.01 and ₹1000000' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customer = await client.query(
      'SELECT id, name, phone FROM customers WHERE id = $1 FOR UPDATE',
      [req.user.id]
    );
    if (customer.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Customer not found' });
    }

    const wallet = await ensureWallet(client, req.user.id);
    const referenceId = 'WALLET_TOPUP_' + req.user.id + '_' + Date.now() + '_' + crypto.randomBytes(5).toString('hex');

    const tx = await client.query(
      `INSERT INTO wallet_transactions
        (wallet_id, customer_id, type, amount, balance_before, balance_after,
         reserved_before, reserved_after, status, reference_id, metadata)
       VALUES ($1, $2, 'TOPUP', $3, $4, $4, $5, $5, 'pending', $6, $7)
       RETURNING id, reference_id, status, amount, created_at`,
      [
        wallet.id,
        req.user.id,
        amount,
        Number(wallet.available_balance),
        Number(wallet.reserved_balance),
        referenceId,
        JSON.stringify({ provider: 'cashfree', stage: 'intent' })
      ]
    );

    const phone = String(customer.rows[0].phone || '').replace(/\\D/g, '').slice(-10);
    if (!/^\\d{10}$/.test(phone)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'A valid 10-digit customer phone number is required for payment' });
    }

    const order = await cashfreeRequest('/orders', 'POST', {
      order_id: referenceId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: 'gofixo_customer_' + req.user.id,
        customer_name: String(customer.rows[0].name || 'Gofixo Customer').slice(0, 100),
        customer_phone: phone
      },
      order_meta: {
        return_url: (process.env.CASHFREE_RETURN_URL || 'https://gofixo.mob13r.com/api/wallet/payment-return?order_id={order_id}'),
        notify_url: process.env.CASHFREE_WEBHOOK_URL || 'https://gofixo.mob13r.com/api/wallet/webhooks/cashfree'
      },
      order_note: 'Gofixo wallet top-up'
    });

    await client.query(
      `UPDATE wallet_transactions
       SET metadata = $1::jsonb
       WHERE id = $2`,
      [
        JSON.stringify({
          provider: 'cashfree',
          stage: 'order_created',
          order_id: order.order_id || referenceId,
          cf_order_id: order.cf_order_id || null,
          payment_session_id: order.payment_session_id || null,
          amount
        }),
        tx.rows[0].id
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({
      payment_provider: 'cashfree',
      environment: String(process.env.CASHFREE_ENV || 'sandbox').toLowerCase(),
      order_id: order.order_id || referenceId,
      payment_session_id: order.payment_session_id,
      transaction: tx.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

router.get('/topup-status/:orderId', requireAuth(['customer']), async (req, res, next) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const result = await pool.query(
      `SELECT wt.id, wt.type, wt.amount, wt.status, wt.reference_id, wt.created_at, wt.metadata
       FROM wallet_transactions wt
       WHERE wt.customer_id = $1 AND wt.type = 'TOPUP' AND wt.reference_id = $2
       LIMIT 1`,
      [req.user.id, orderId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Top-up not found' });
    const row = result.rows[0];
    res.json({
      order_id: row.reference_id,
      amount: Number(row.amount),
      status: row.status,
      transaction_id: row.id,
      metadata: row.metadata || {}
    });
  } catch (err) {
    next(err);
  }
});

// Cashfree signs timestamp + raw request body. This endpoint must be mounted
// with express.raw() before the global express.json() middleware.
router.post('/webhooks/cashfree', async (req, res) => {
  try {
    const signature = String(req.headers['x-webhook-signature'] || '');
    const timestamp = String(req.headers['x-webhook-timestamp'] || '');
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const secret = process.env.CASHFREE_CLIENT_SECRET || '';

    if (!signature || !timestamp || !rawBody || !secret) {
      return res.status(400).json({ error: 'Invalid Cashfree webhook request' });
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(timestamp + rawBody)
      .digest('base64');

    const provided = Buffer.from(signature);
    const calculated = Buffer.from(expected);
    if (provided.length !== calculated.length || !crypto.timingSafeEqual(provided, calculated)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const payload = JSON.parse(rawBody);
    const orderId = String(payload?.data?.order?.order_id || '').trim();
    const paymentStatus = String(payload?.data?.payment?.payment_status || '').toUpperCase();

    if (!orderId) return res.status(400).json({ error: 'Missing order id' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const tx = await client.query(
        `SELECT wt.*, w.available_balance, w.reserved_balance
         FROM wallet_transactions wt
         JOIN wallets w ON w.id = wt.wallet_id
         WHERE wt.type = 'TOPUP' AND wt.reference_id = $1
         FOR UPDATE`,
        [orderId]
      );

      if (tx.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Wallet top-up order not found' });
      }

      const row = tx.rows[0];
      const paidAmount = Number(
        payload?.data?.payment?.payment_amount ??
        payload?.data?.order?.order_amount ??
        0
      );
      const expectedAmount = Number(row.amount);

      if (Number.isFinite(paidAmount) && paidAmount > 0 && Math.abs(paidAmount - expectedAmount) > 0.01) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Webhook amount does not match wallet top-up' });
      }

      if (['SUCCESS', 'PAID', 'COMPLETED'].includes(paymentStatus)) {
        if (row.status === 'success') {
          await client.query('COMMIT');
          return res.json({ received: true, duplicate: true });
        }

        const before = Number(row.available_balance);
        const after = Number((before + expectedAmount).toFixed(2));

        await client.query(
          `UPDATE wallets
           SET available_balance = $1, updated_at = NOW()
           WHERE id = $2`,
          [after, row.wallet_id]
        );

        await client.query(
          `UPDATE wallet_transactions
           SET status = 'success',
               balance_before = $1,
               balance_after = $2,
               metadata = metadata || $3::jsonb
           WHERE id = $4`,
          [
            before,
            after,
            JSON.stringify({
              provider: 'cashfree',
              payment_status: paymentStatus,
              cf_payment_id: payload?.data?.payment?.cf_payment_id || null
            }),
            row.id
          ]
        );
      } else if (['FAILED', 'CANCELLED', 'USER_DROPPED'].includes(paymentStatus)) {
        await client.query(
          `UPDATE wallet_transactions
           SET status = 'failed',
               metadata = metadata || $1::jsonb
           WHERE id = $2 AND status = 'pending'`,
          [
            JSON.stringify({
              provider: 'cashfree',
              payment_status: paymentStatus,
              cf_payment_id: payload?.data?.payment?.cf_payment_id || null
            }),
            row.id
          ]
        );
      }

      await client.query('COMMIT');
      return res.json({ received: true });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Cashfree wallet webhook processing error:', err.message);
      return res.status(500).json({ error: 'Webhook processing failed' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Cashfree webhook error:', err.message);
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }
});

router.get('/payment-return', async (req, res) => {
  res.status(200).type('html').send('<!doctype html><html><body><h3>Gofixo payment received</h3><p>You can return to the Gofixo app. Payment status is verified by Gofixo.</p></body></html>');
});

module.exports = router;
