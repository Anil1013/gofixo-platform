'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rateCard = require('../config/pricing/delhi-ncr-launch-draft.json');

test('Delhi NCR draft rate card is explicitly not live', () => {
  assert.equal(rateCard.status, 'proposed_not_live');
  assert.ok(rateCard.services.length >= 10);
});

test('every published item has a valid mode, amount or inspection fee, and partner share', () => {
  const modes = new Set(['fixed', 'per_unit', 'per_hour', 'per_item', 'per_kg', 'per_sqft', 'inspection_quote']);
  for (const category of rateCard.services) {
    assert.ok(category.category);
    assert.ok(category.commissionKey);
    assert.ok(category.items.length > 0);
    for (const item of category.items) {
      assert.ok(item.key, `missing key in ${category.category}`);
      assert.ok(modes.has(item.mode), `invalid mode for ${item.key}`);
      assert.ok(Number.isFinite(item.partnerPercent) && item.partnerPercent >= 0 && item.partnerPercent <= 100);
      if (item.mode === 'inspection_quote') {
        assert.ok(Number.isFinite(item.visitFee), `inspection item ${item.key} must show visit fee`);
      } else {
        assert.ok(Number.isFinite(item.price) && item.price > 0, `item ${item.key} must have a positive price`);
      }
    }
  }
});

test('category commission agrees with partner share on all listed items', () => {
  for (const category of rateCard.services) {
    const commission = rateCard.commercial_rules.commission_rates_percent[category.commissionKey];
    assert.ok(Number.isFinite(commission), `missing commission for ${category.commissionKey}`);
    for (const item of category.items) {
      assert.equal(item.partnerPercent, 100 - commission, `share mismatch for ${item.key}`);
    }
  }
});

test('materials are explicitly excluded from commission', () => {
  assert.equal(rateCard.commercial_rules.material_pass_through_commission_percent, 0);
});

test('all home-service categories enforce at least 20 percent commission', () => {
  for (const category of rateCard.services) {
    const commission = rateCard.commercial_rules.commission_rates_percent[category.commissionKey];
    assert.ok(commission >= 20, `commission below 20 percent for ${category.category}`);
    for (const item of category.items) assert.ok(item.partnerPercent <= 80, `partner share exceeds 80 percent for ${item.key}`);
  }
});

test('repair diagnosis charges are transparent and credited on accepted same-visit repair', () => {
  const repairKeys = new Set(['electrician_visit','plumber_visit','carpenter_visit','ac_diagnosis','appliance_diagnosis','fridge_diagnosis','washer_diagnosis','ro_diagnosis']);
  for (const category of rateCard.services) {
    for (const item of category.items) {
      if (!repairKeys.has(item.key)) continue;
      assert.equal(item.mode, 'inspection_quote');
      assert.ok(item.visitFee > 0);
      assert.equal(item.creditVisitFeeOnApprovedRepair, true);
    }
  }
  assert.match(rateCard.commercial_rules.visit_fee_policy.repair_inspection, /declines? repair/);
  assert.match(rateCard.commercial_rules.material_policy, /customer-supplied parts\/materials are the default/);
});
