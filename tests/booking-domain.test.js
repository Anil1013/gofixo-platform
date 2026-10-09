const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateRideFare } = require('../services/ride-pricing');
const { normalizeServiceCategory, normalizeServiceCategories } = require('../services/catalog');

test('ride pricing is independent and deterministic', () => {
  assert.equal(calculateRideFare('bike', 1), 36);
  assert.equal(calculateRideFare('auto', 1), 48);
  assert.equal(calculateRideFare('car', 1), 70);
});

test('ride pricing rejects non-ride provider types', () => {
  assert.throws(() => calculateRideFare('skilled_worker', 5), /Invalid ride pricing input/);
});

test('home-service categories normalize consistently', () => {
  assert.equal(normalizeServiceCategory('Electrician'), 'electrician');
  assert.equal(normalizeServiceCategory('AC service'), 'ac_service');
  assert.equal(normalizeServiceCategory('plumbing'), 'plumber');
  assert.equal(normalizeServiceCategory('anything custom'), 'other');
  assert.deepEqual(
    normalizeServiceCategories(['Electrician', 'electrician', 'AC Service']),
    ['electrician', 'ac_service'],
  );
});
