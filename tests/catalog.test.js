'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HOME_SERVICE_CATALOG,
  normalizeServiceCategory,
  normalizeServiceCategories,
  getServiceCatalog,
  isValidServiceCategoryKey,
} = require('../services/catalog');

test('catalog has unique stable keys and HTTPS images for every home service', () => {
  const keys = HOME_SERVICE_CATALOG.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.length >= 20);
  for (const item of HOME_SERVICE_CATALOG) {
    assert.ok(item.label, `missing label for ${item.key}`);
    assert.match(item.imageUrl, /^https:\/\//, `invalid image URL for ${item.key}`);
    assert.ok(['general_worker', 'skilled_worker'].includes(item.providerType));
  }
});

test('senior and disability care keeps the stable elder_care booking key', () => {
  const item = HOME_SERVICE_CATALOG.find((entry) => entry.key === 'elder_care');
  assert.ok(item);
  assert.equal(item.label, 'Senior & Disability Care');
  assert.equal(normalizeServiceCategory('senior care'), 'elder_care');
});

test('category normalization deduplicates aliases without changing ride categories', () => {
  assert.equal(normalizeServiceCategory('AC'), 'ac_service');
  assert.equal(normalizeServiceCategory('plumbing'), 'plumber');
  assert.deepEqual(normalizeServiceCategories(['AC', 'ac_service', 'Plumbing']), ['ac_service', 'plumber']);
  assert.equal(normalizeServiceCategory('bike'), 'other');
});

test('public catalog maps each service to its existing display base fare', () => {
  const items = getServiceCatalog();
  assert.equal(items.length, HOME_SERVICE_CATALOG.length);
  assert.equal(items.find((item) => item.key === 'cleaning').baseFare, 349);
  assert.equal(items.find((item) => item.key === 'elder_care').label, 'Senior & Disability Care');
});

test('dynamic service keys accept safe stable slugs without treating unknown keys as Other', () => {
  assert.equal(isValidServiceCategoryKey('home_deep_cleaning'), true);
  assert.equal(isValidServiceCategoryKey('senior_care_plus'), true);
  assert.equal(isValidServiceCategoryKey('Home Cleaning'), false);
  assert.equal(isValidServiceCategoryKey('../admin'), false);
  assert.equal(isValidServiceCategoryKey(''), false);
});
