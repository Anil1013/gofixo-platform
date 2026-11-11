'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveServiceCatalogBooking } = require('../services/service-catalog-booking');

test('accepts an active catalog item with matching worker type and positive server price', () => {
  assert.deepEqual(resolveServiceCatalogBooking({
    is_active: true, provider_type: 'skilled_worker', base_fare: '399.00',
  }, 'skilled_worker'), { baseFare: 399 });
});

test('blocks categories disabled by the admin', () => {
  assert.match(resolveServiceCatalogBooking({
    is_active: false, provider_type: 'general_worker', base_fare: 299,
  }, 'general_worker').error, /currently unavailable/);
});

test('blocks stale clients requesting the wrong partner type', () => {
  assert.match(resolveServiceCatalogBooking({
    is_active: true, provider_type: 'skilled_worker', base_fare: 399,
  }, 'general_worker').error, /different partner type/);
});

test('blocks missing, zero, negative and non-finite prices', () => {
  for (const base_fare of [undefined, 0, -1, 'not-a-price', Infinity]) {
    assert.match(resolveServiceCatalogBooking({
      is_active: true, provider_type: 'general_worker', base_fare,
    }, 'general_worker').error, /price is temporarily unavailable/);
  }
});
