const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateRideFare } = require('../services/ride-pricing');
const { HOME_SERVICE_CATALOG, normalizeServiceCategory, normalizeServiceCategories, getServiceBaseFare, isServiceCategoryForProvider } = require('../services/catalog');

test('ride pricing is independent and deterministic', () => {
  assert.equal(calculateRideFare('bike', 1), 36);
  assert.equal(calculateRideFare('auto', 1), 48);
  assert.equal(calculateRideFare('car', 1), 70);
});

test('home-service categories stay isolated to their registered partner type', () => {
  assert.equal(isServiceCategoryForProvider('electrician', 'skilled_worker'), true);
  assert.equal(isServiceCategoryForProvider('cleaning', 'general_worker'), true);
  assert.equal(isServiceCategoryForProvider('electrician', 'general_worker'), false);
  assert.equal(isServiceCategoryForProvider('cleaning', 'skilled_worker'), false);
  assert.equal(isServiceCategoryForProvider('bike', 'bike'), false);
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


test('every customer-facing home service is bookable by its matching partner type', () => {
  const keys = HOME_SERVICE_CATALOG.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length, 'service category keys must be unique');
  assert.ok(keys.length >= 20, 'the full home-service catalog must remain available');

  for (const item of HOME_SERVICE_CATALOG) {
    assert.ok(['general_worker', 'skilled_worker'].includes(item.providerType), item.key);
    assert.equal(normalizeServiceCategory(item.key), item.key, item.key);
    assert.equal(isServiceCategoryForProvider(item.key, item.providerType), true, item.key);
    assert.ok(getServiceBaseFare(item.key) > 0, item.key + ' must have a positive starting fare');

    const otherProviderType = item.providerType === 'general_worker' ? 'skilled_worker' : 'general_worker';
    assert.equal(isServiceCategoryForProvider(item.key, otherProviderType), false, item.key);
  }
});

test('home-service catalog exposes stable labels and usable images', () => {
  for (const item of HOME_SERVICE_CATALOG) {
    assert.ok(item.label && item.label.trim().length > 0, item.key + ' label');
    assert.match(item.imageUrl, /^https:\/\//, item.key + ' image URL must use HTTPS');
  }
});
