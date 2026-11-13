'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateServicePrice } = require('../services/service-pricing');

test('per-room cleaning calculates quantity and add-ons transparently', () => {
  const result = calculateServicePrice({
    pricingMode: 'per_unit',
    unitLabel: 'room',
    unitPrice: 299,
    minimumQuantity: 1,
    maximumQuantity: 8,
    quantityStep: 1,
    estimatedMinutes: 60,
    addOns: [{ key: 'balcony', price: 150 }],
  }, { quantity: 2, addOns: ['balcony'] });

  assert.equal(result.baseAmount, 598);
  assert.equal(result.addOnsAmount, 150);
  assert.equal(result.total, 748);
  assert.equal(result.unitLabel, 'room');
  assert.equal(result.requiresQuote, false);
});

test('laundry supports minimum order and per-kg pricing', () => {
  const result = calculateServicePrice({
    pricingMode: 'per_kg',
    unitLabel: 'kg',
    unitPrice: 99,
    minimumQuantity: 5,
    maximumQuantity: 30,
    quantityStep: 0.5,
    minimumCharge: 495,
  }, { quantity: 5.5 });

  assert.equal(result.total, 544.5);
  assert.equal(result.quantity, 5.5);
});

test('fixed package charges once, not once per selected bedroom', () => {
  const result = calculateServicePrice({
    pricingMode: 'fixed',
    unitLabel: 'home package',
    unitPrice: 2499,
  }, { quantity: 3 });

  assert.equal(result.total, 2499);
});

test('inspection-first repair displays visit fee and requires an approved quote', () => {
  const result = calculateServicePrice({
    pricingMode: 'inspection_quote',
    unitLabel: 'visit',
    visitFee: 199,
    estimatedMinutes: 30,
  });

  assert.equal(result.total, 199);
  assert.equal(result.requiresQuote, true);
  assert.equal(result.visitFeeCreditedOnApproval, false);
});

test('repair visit fee is credited when customer approves repair in the same visit', () => {
  const result = calculateServicePrice({
    pricingMode: 'inspection_quote',
    unitLabel: 'visit',
    visitFee: 149,
    creditVisitFeeOnApprovedRepair: true,
  });
  assert.equal(result.total, 149);
  assert.equal(result.requiresQuote, true);
  assert.equal(result.visitFeeCreditedOnApproval, true);
  assert.match(result.quoteMessage, /only the disclosed visit fee/);
});

test('rejects invalid quantities and unknown add-ons', () => {
  const rule = { pricingMode: 'per_item', unitPrice: 20, unitLabel: 'piece' };
  assert.throws(() => calculateServicePrice(rule, { quantity: 0 }), /positive number/);
  assert.throws(() => calculateServicePrice(rule, { quantity: 1, addOns: ['not-configured'] }), /Unknown add-on/);
});

test('supports admin-configured home-size packages such as 1BHK and 3BHK', () => {
  const rule = {
    pricingMode: 'fixed',
    variants: [
      { key: '1bhk', label: '1 BHK', price: 1299 },
      { key: '2bhk', label: '2 BHK', price: 1699 },
      { key: '3bhk', label: '3 BHK', price: 2199 },
    ],
  };
  const result = calculateServicePrice(rule, { variantKey: '3bhk' });
  assert.equal(result.total, 2199);
  assert.equal(result.variantLabel, '3 BHK');
  assert.equal(result.variantKey, '3bhk');
  assert.throws(() => calculateServicePrice(rule, { variantKey: '5bhk' }), /valid service package/);
});
