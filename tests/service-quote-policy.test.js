'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildServiceQuote } = require('../services/service-quote-policy');

test('credits disclosed visit fee against labour and totals approved materials', () => {
  const q = buildServiceQuote({
    description: 'Replace faulty motor',
    labourAmount: 1500,
    creditVisitFee: true,
    materials: [{ name: 'Motor', quantity: 1, unitPrice: 850 }],
  }, 299);
  assert.equal(q.visitFeeCreditAmount, 299);
  assert.equal(q.serviceAmount, 1201);
  assert.equal(q.materialsAmount, 850);
  assert.equal(q.totalAmount, 2051);
});

test('does not credit visit fee unless customer-facing quote explicitly opts in', () => {
  const q = buildServiceQuote({ description: 'Repair', labourAmount: 500 }, 299);
  assert.equal(q.visitFeeCreditAmount, 0);
  assert.equal(q.serviceAmount, 799);
  assert.equal(q.totalAmount, 799);
});

test('rejects malformed and excessive material entries', () => {
  assert.throws(() => buildServiceQuote({ description: 'Repair', labourAmount: 100, materials: [{ name: 'Part', quantity: -1, unitPrice: 10 }] }), /quantity/);
  assert.throws(() => buildServiceQuote({ description: 'Repair', labourAmount: 100, materials: [{ name: 'Part', quantity: 1, unitPrice: -10 }] }), /unitPrice/);
  assert.throws(() => buildServiceQuote({ description: 'Repair', labourAmount: 100, materials: [{ name: 'Part', quantity: 1, unitPrice: 10 }, { name: 'part', quantity: 1, unitPrice: 10 }] }), /Duplicate/);
  assert.throws(() => buildServiceQuote({ description: 'Repair', labourAmount: 0 }), /greater than zero/);
});

test('requires a clear customer-visible explanation', () => {
  assert.throws(() => buildServiceQuote({ labourAmount: 100 }), /description/);
});

test('prevents visit-fee credit from reducing labour to zero', () => {
  assert.throws(() => buildServiceQuote({
    description: 'Repair',
    labourAmount: 299,
    creditVisitFee: true,
  }, 299), /remain positive/);
});


test('supports up to 50 distinct material items and totals each quantity correctly', () => {
  const materials = Array.from({ length: 50 }, (_, index) => ({
    name: 'Part ' + (index + 1), quantity: 2, unitPrice: 1.25,
  }));
  const q = buildServiceQuote({ description: 'Multi-part repair', labourAmount: 500, materials });
  assert.equal(q.materials.length, 50);
  assert.equal(q.materialsAmount, 125);
  assert.equal(q.totalAmount, 625);
});

test('rejects more than 50 material items', () => {
  const materials = Array.from({ length: 51 }, (_, index) => ({
    name: 'Part ' + (index + 1), quantity: 1, unitPrice: 1,
  }));
  assert.throws(() => buildServiceQuote({
    description: 'Large repair', labourAmount: 500, materials,
  }), /at most 50 items/);
});

test('rounds fractional material totals to paise before calculating quote total', () => {
  const q = buildServiceQuote({
    description: 'Fractional quantity repair',
    labourAmount: 100.10,
    materials: [{ name: 'Wire', quantity: 1.5, unitPrice: 10.10 }],
  });
  assert.equal(q.materials[0].total, 15.15);
  assert.equal(q.materialsAmount, 15.15);
  assert.equal(q.totalAmount, 115.25);
});
