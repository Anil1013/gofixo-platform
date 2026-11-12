'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateWalletRelease, calculateWalletCapture, calculateWalletAdjustment } = require('../services/wallet-reserve-policy');

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

test('replaces the booking reserve exactly when a customer approves a revised quote', () => {
  assert.deepEqual(calculateWalletAdjustment({
    availableBalance: 500, reservedBalance: 900,
    currentReserveAmount: 300, newReserveAmount: 450,
  }), {
    delta: 150, availableAfter: 350, reservedAfter: 1050,
    currentReserve: 300, newReserve: 450,
  });
  assert.deepEqual(calculateWalletAdjustment({
    availableBalance: 500, reservedBalance: 900,
    currentReserveAmount: 300, newReserveAmount: 200,
  }), {
    delta: -100, availableAfter: 600, reservedAfter: 800,
    currentReserve: 300, newReserve: 200,
  });
});

test('does not release another booking reserve when this booking reserve is missing', () => {
  assert.throws(() => calculateWalletAdjustment({
    availableBalance: 500, reservedBalance: 400,
    currentReserveAmount: 500, newReserveAmount: 100,
  }), (error) => error.status === 409 && /current reserve/.test(error.message));
});

test('returns insufficient funds without mutating balances for an increased quote', () => {
  assert.equal(calculateWalletAdjustment({
    availableBalance: 99.99, reservedBalance: 300,
    currentReserveAmount: 300, newReserveAmount: 400,
  }), null);
});
