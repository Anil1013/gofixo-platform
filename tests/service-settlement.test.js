'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateServiceSettlement } = require('../services/service-settlement');

test('splits service amount by partner share and passes approved materials through', () => {
  const result = calculateServiceSettlement({
    serviceAmount: 1000,
    partnerPercent: 80,
    approvedMaterialAmount: 250,
  });
  assert.equal(result.partnerServiceEarning, 800);
  assert.equal(result.platformCommission, 200);
  assert.equal(result.partnerTotal, 1050);
  assert.equal(result.customerTotalBeforeTax, 1250);
});

test('caregiving partner share is configurable independently', () => {
  const result = calculateServiceSettlement({ serviceAmount: 1599, partnerPercent: 80 });
  assert.equal(result.partnerServiceEarning, 1279.2);
  assert.equal(result.platformCommission, 319.8);
});

test('rejects a price that falls below the partner minimum earning', () => {
  assert.throws(() => calculateServiceSettlement({
    serviceAmount: 149,
    partnerPercent: 80,
    minimumPartnerServiceEarning: 150,
  }), /minimum partner earning/);
});

test('rejects invalid partner share', () => {
  assert.throws(() => calculateServiceSettlement({ serviceAmount: 100, partnerPercent: 81 }), /partnerPercent/);
});
