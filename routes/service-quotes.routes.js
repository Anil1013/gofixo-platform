'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { sendCustomerFcm } = require('../services/push');
const { buildServiceQuote } = require('../services/service-quote-policy');

const router = express.Router();
const INSPECTION_CATEGORIES = new Set([
  'electrician', 'plumber', 'ac_service', 'carpenter', 'appliance_repair',
  'refrigerator_repair', 'washing_machine_repair', 'ro_water_purifier', 'geyser_repair',
]);
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

router.get('/:bookingId', requireAuth(['customer', 'provider']), async (req, res, next) => {
  try {
    const booking = await pool.query(
      'SELECT id, customer_id, provider_id, service_type FROM bookings WHERE id = $1',
      [req.params.bookingId]
    );
    if (!booking.rows.length) return res.status(404).json({ error: 'Booking not found' });
    const row = booking.rows[0];
    const owns = req.user.role === 'customer'
      ? Number(row.customer_id) === Number(req.user.id)
      : Number(row.provider_id) === Number(req.user.id);
    if (!owns) return res.status(403).json({ error: 'This booking does not belong to you' });
    if (row.service_type !== 'services') return res.status(400).json({ error: 'Quotes are only available for Home Services' });
    const quotes = await pool.query(
      'SELECT id, status, description, labour_amount, visit_fee_amount, visit_fee_credit_amount, service_amount, materials_amount, total_amount, materials, created_at, customer_response_at FROM service_job_quotes WHERE booking_id = $1 ORDER BY id DESC',
      [req.params.bookingId]
    );
    return res.json({ quotes: quotes.rows });
  } catch (err) {
    next(err);
  }
});

// Partner submits a transparent inspection/labour/material quote. The customer
// must approve it before the Wallet reserve or final service amount changes.
router.post('/:bookingId/propose', requireAuth(['provider']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT id, customer_id, provider_id, service_type, service_category, status, fare_amount FROM bookings WHERE id = $1 FOR UPDATE',
      [req.params.bookingId]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    const booking = result.rows[0];
    if (Number(booking.provider_id) !== Number(req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This booking does not belong to you' });
    }
    if (booking.service_type !== 'services' || !['accepted', 'arrived'].includes(booking.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A Home Service quote can only be proposed before the customer PIN starts the job' });
    }
    if (req.body?.creditVisitFee === true && !INSPECTION_CATEGORIES.has(booking.service_category)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Visit-fee credit is only available for eligible inspection and repair services' });
    }
    const previous = await client.query(
      'SELECT visit_fee_amount FROM service_job_quotes WHERE booking_id = $1 ORDER BY id ASC LIMIT 1',
      [booking.id]
    );
    const visitFee = previous.rows.length ? Number(previous.rows[0].visit_fee_amount) : Number(booking.fare_amount);
    const quote = buildServiceQuote(req.body, visitFee);
    await client.query(
      "UPDATE service_job_quotes SET status = 'superseded', updated_at = NOW() WHERE booking_id = $1 AND status = 'proposed'",
      [booking.id]
    );
    const inserted = await client.query(
      `INSERT INTO service_job_quotes
        (booking_id, provider_id, customer_id, status, description, labour_amount,
         visit_fee_amount, visit_fee_credit_amount, service_amount, materials_amount,
         total_amount, materials)
       VALUES ($1,$2,$3,'proposed',$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       RETURNING id, status, description, labour_amount, visit_fee_amount,
         visit_fee_credit_amount, service_amount, materials_amount, total_amount, materials, created_at`,
      [booking.id, booking.provider_id, booking.customer_id, quote.description,
        quote.labourAmount, quote.visitFeeAmount, quote.visitFeeCreditAmount,
        quote.serviceAmount, quote.materialsAmount, quote.totalAmount,
        JSON.stringify(quote.materials)]
    );
    await client.query('COMMIT');
    pool.query('SELECT fcm_token FROM customers WHERE id = $1', [booking.customer_id])
      .then(async (customer) => {
        const token = customer.rows[0]?.fcm_token;
        if (!token) return;
        const sent = await sendCustomerFcm(token, {
          type: 'service_quote_pending',
          title: 'Gofixo — Home Service quote',
          body: 'Your partner submitted a repair/labour and material quote. Review and approve or decline it in the app.',
          booking_id: booking.id,
        });
        if (sent?.expired) await pool.query('UPDATE customers SET fcm_token = NULL WHERE id = $1 AND fcm_token = $2', [booking.customer_id, token]);
      })
      .catch((error) => console.error('Home-service quote notification failed:', error.message));
    return res.status(201).json({ quote: inserted.rows[0], message: 'Quote sent to customer for approval' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'A quote is already awaiting customer approval' });
    if (err instanceof TypeError || err instanceof RangeError) return res.status(400).json({ error: err.message });
    return next(err);
  } finally {
    client.release();
  }
});

// Customer approval atomically adjusts the reserved wallet amount. Declining
// leaves the original disclosed visit fee reserve unchanged.
router.post('/:bookingId/respond', requireAuth(['customer']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const decision = String(req.body?.decision || '').trim().toLowerCase();
    if (!['approve', 'decline'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approve' or 'decline'" });
    }
    await client.query('BEGIN');
    const bookingResult = await client.query(
      'SELECT id, customer_id, provider_id, service_type, status FROM bookings WHERE id = $1 FOR UPDATE',
      [req.params.bookingId]
    );
    if (!bookingResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    const booking = bookingResult.rows[0];
    if (Number(booking.customer_id) !== Number(req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This booking does not belong to you' });
    }
    if (booking.service_type !== 'services' || !['accepted', 'arrived'].includes(booking.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'The quote can no longer be changed after the job starts' });
    }
    const quoteResult = await client.query(
      "SELECT * FROM service_job_quotes WHERE booking_id = $1 AND status = 'proposed' ORDER BY id DESC LIMIT 1 FOR UPDATE",
      [booking.id]
    );
    if (!quoteResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'There is no quote awaiting approval' });
    }
    const quote = quoteResult.rows[0];
    if (decision === 'approve') {
      const reserve = await client.query(
        "SELECT * FROM wallet_transactions WHERE booking_id = $1 AND type = 'BOOKING_RESERVE' AND status = 'success' FOR UPDATE",
        [booking.id]
      );
      if (!reserve.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The original Gofixo Wallet reservation is missing' });
      }
      const wallet = await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [reserve.rows[0].wallet_id]);
      if (!wallet.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Customer wallet could not be found' });
      }
      const w = wallet.rows[0];
      const oldReserve = money(reserve.rows[0].amount);
      const newReserve = money(quote.total_amount);
      const delta = money(newReserve - oldReserve);
      const available = money(w.available_balance);
      if (delta > available) {
        await client.query('ROLLBACK');
        return res.status(402).json({ error: 'Insufficient Gofixo Wallet balance for this quote. Add funds before approving.' });
      }
      const reservedBefore = money(w.reserved_balance);
      const availableAfter = money(available - delta);
      const reservedAfter = money(reservedBefore + delta);
      if (reservedAfter < 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Wallet reserved balance does not match this booking. Contact Gofixo support before approving.' });
      }
      await client.query(
        'UPDATE wallets SET available_balance = $1, reserved_balance = $2, updated_at = NOW() WHERE id = $3',
        [availableAfter, reservedAfter, w.id]
      );
      await client.query(
        `INSERT INTO wallet_transactions
          (wallet_id, customer_id, booking_id, type, amount, balance_before, balance_after,
           reserved_before, reserved_after, status, reference_id, metadata)
         VALUES ($1,$2,$3,'SERVICE_QUOTE_ADJUSTMENT',$4,$5,$6,$7,$8,'success',$9,$10)
         ON CONFLICT (type, reference_id) DO NOTHING`,
        [w.id, booking.customer_id, booking.id, Math.abs(delta), available, availableAfter,
          reservedBefore, reservedAfter, 'SERVICE_QUOTE_ADJUSTMENT_' + quote.id,
          JSON.stringify({ quote_id: quote.id, direction: delta >= 0 ? 'reserve_more' : 'release_excess' })]
      );
      await client.query('UPDATE wallet_transactions SET amount = $1 WHERE id = $2', [newReserve, reserve.rows[0].id]);
      await client.query(
        "UPDATE service_job_quotes SET status = 'superseded', updated_at = NOW() WHERE booking_id = $1 AND status = 'approved'",
        [booking.id]
      );
      await client.query(
        "UPDATE service_job_quotes SET status = 'approved', customer_response_at = NOW(), updated_at = NOW() WHERE id = $1",
        [quote.id]
      );
      await client.query('UPDATE bookings SET fare_amount = $1 WHERE id = $2', [quote.service_amount, booking.id]);
    } else {
      await client.query(
        "UPDATE service_job_quotes SET status = 'declined', customer_response_at = NOW(), updated_at = NOW() WHERE id = $1",
        [quote.id]
      );
    }
    await client.query('COMMIT');
    return res.json({
      message: decision === 'approve' ? 'Quote approved and Wallet reserve updated' : 'Quote declined; no new charge was reserved and the previous approved amount remains unchanged',
      decision,
      quote_id: Number(quote.id),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
