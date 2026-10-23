const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

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

// Gateway checkout and wallet top-ups are intentionally disabled.
// Never credit a wallet from a client-submitted QR screenshot or UTR alone.
router.post('/topup-intent', requireAuth(['customer']), (_req, res) =>
  res.status(410).json({ error: 'Wallet top-ups are disabled. Contact Gofixo support for payment verification.' })
);
router.get('/topup-status/:orderId', requireAuth(['customer']), (_req, res) =>
  res.status(410).json({ error: 'Gateway wallet top-ups are disabled.' })
);

module.exports = router;
