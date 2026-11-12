'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateWalletRelease, calculateWalletCapture } = require('../services/wallet-reserve-policy');

test('releases the exact booking reserve without changing total wallet funds', () => {
  assert.deepEqual(calculateWalletRelease({
    availableBalance: 500, reservedBalance: 700, reserveAmount: 250,
  }), { availableAfter: 750, reservedAfter: 450, amount: 250 });
});

test('refuses release when the reserved balance cannot cover the booking', () => {
  assert.throws(() => calculateWalletRelease({
    availableBalance: 500, reservedBalance: 100, reserveAmount: 250,
  }), (error) => error.status === 409 && /does not cover/.test(error.message));
  assert.throws(() => calculateWalletRelease({
    availableBalance: 500, reservedBalance: 249.99, reserveAmount: 250,
  }), (error) => error.status === 409);
});

test('captures only when both booking reserve and wallet reserved balance cover the charge', () => {
  assert.deepEqual(calculateWalletCapture({
    reservedBalance: 700, reserveAmount: 300, captureAmount: 250,
  }), { reservedAfter: 450, amount: 250 });
  assert.equal(calculateWalletCapture({
    reservedBalance: 100, reserveAmount: 300, captureAmount: 250,
  }), null);
  assert.equal(calculateWalletCapture({
    reservedBalance: 249.99, reserveAmount: 300, captureAmount: 250,
  }), null);
  assert.equal(calculateWalletCapture({
    reservedBalance: 700, reserveAmount: 100, captureAmount: 250,
  }), null);
});
