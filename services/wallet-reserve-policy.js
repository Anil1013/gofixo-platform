'use strict';

function money(value, field) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) {
    throw new TypeError(`${field} must be a valid non-negative wallet amount`);
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function calculateWalletRelease({ availableBalance, reservedBalance, reserveAmount }) {
  const available = money(availableBalance, 'availableBalance');
  const reserved = money(reservedBalance, 'reservedBalance');
  const amount = money(reserveAmount, 'reserveAmount');
  if (reserved < amount) {
    const error = new Error('Wallet reserved balance does not cover this booking release; no funds were changed.');
    error.status = 409;
    throw error;
  }
  return Object.freeze({
    availableAfter: money(available + amount, 'availableAfter'),
    reservedAfter: money(reserved - amount, 'reservedAfter'),
    amount,
  });
}

function calculateWalletCapture({ reservedBalance, reserveAmount, captureAmount }) {
  const reserved = money(reservedBalance, 'reservedBalance');
  const originalReserve = money(reserveAmount, 'reserveAmount');
  const capture = money(captureAmount, 'captureAmount');
  if (originalReserve < capture || reserved < capture) return null;
  return Object.freeze({ reservedAfter: money(reserved - capture, 'reservedAfter'), amount: capture });
}

module.exports = { calculateWalletRelease, calculateWalletCapture };
