'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateServiceSettlement } = require('../services/service-settlement');

test('splits service amount by partner share and passes approved materials through', () => {
  const result = calculateServiceSettlement({
    serviceAmount: 1000,
    partnerPercent: 88,
    approvedMaterialAmount: 250,
  });
  assert.equal(result.partnerServiceEarning, 880);
  assert.equal(result.platformCommission, 120);
  assert.equal(result.partnerTotal, 1130);
  assert.equal(result.customerTotalBeforeTax, 1250);
});

test('caregiving partner share is configurable independently', () => {
  const result = calculateServiceSettlement({ serviceAmount: 1599, partnerPercent: 90 });
  assert.equal(result.partnerServiceEarning, 1439.1);
  assert.equal(result.platformCommission, 159.9);
});

test('rejects a price that falls below the partner minimum earning', () => {
  assert.throws(() => calculateServiceSettlement({
    serviceAmount: 149,
    partnerPercent: 88,
    minimumPartnerServiceEarning: 150,
  }), /minimum partner earning/);
});

test('rejects invalid partner share', () => {
  assert.throws(() => calculateServiceSettlement({ serviceAmount: 100, partnerPercent: 101 }), /partnerPercent/);
});
