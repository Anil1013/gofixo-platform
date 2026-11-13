const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateRideFare } = require('../services/ride-pricing');
const { calculateServicePrice } = require('../services/service-pricing');
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

test('home-service pricing applies selected BHK package and approved add-ons', () => {
  const quote = calculateServicePrice({
    pricingMode: 'fixed',
    variants: [
      { key: '1bhk', label: '1 BHK', price: 1299 },
      { key: '2bhk', label: '2 BHK', price: 1799 },
    ],
    addOns: [{ key: 'sofa', label: 'Sofa cleaning', price: 299 }],
  }, { variantKey: '2bhk', addOns: ['sofa'] });
  assert.equal(quote.variantKey, '2bhk');
  assert.equal(quote.baseAmount, 1799);
  assert.equal(quote.addOnsAmount, 299);
  assert.equal(quote.total, 2098);
});

test('home-service per-unit pricing enforces quantity limits and steps', () => {
  const rule = { pricingMode: 'per_unit', unitPrice: 349, minimumQuantity: 2, maximumQuantity: 8, quantityStep: 2 };
  assert.equal(calculateServicePrice(rule, { quantity: 4 }).total, 1396);
  assert.throws(() => calculateServicePrice(rule, { quantity: 1 }), /between 2 and 8/);
  assert.throws(() => calculateServicePrice(rule, { quantity: 3 }), /increments of 2/);
});

test('home-service pricing rejects unknown variants and add-ons', () => {
  const rule = {
    pricingMode: 'fixed',
    variants: [{ key: '1bhk', label: '1 BHK', price: 1299 }],
    addOns: [{ key: 'sofa', price: 299 }],
  };
  assert.throws(() => calculateServicePrice(rule, { variantKey: '3bhk' }), /valid service package/);
  assert.throws(() => calculateServicePrice(rule, { variantKey: '1bhk', addOns: ['unknown'] }), /Unknown add-on/);
});

test('inspection pricing clearly returns a quote-required result', () => {
  const quote = calculateServicePrice({
    pricingMode: 'inspection_quote',
    visitFee: 199,
    creditVisitFeeOnApprovedRepair: true,
  });
  assert.equal(quote.total, 199);
  assert.equal(quote.requiresQuote, true);
  assert.equal(quote.visitFeeCreditedOnApproval, true);
});


test('inspection quote rejects variants and add-ons that it cannot price', () => {
  assert.throws(() => calculateServicePrice({
    pricingMode: 'inspection_quote',
    visitFee: 199,
    variants: [{ key: 'standard', label: 'Standard', price: 499 }],
  }), /inspection_quote supports a visit fee only/);
  assert.throws(() => calculateServicePrice({
    pricingMode: 'inspection_quote',
    visitFee: 199,
    addOns: [{ key: 'parts', label: 'Parts', price: 299 }],
  }), /inspection_quote supports a visit fee only/);
  assert.throws(() => calculateServicePrice({
    pricingMode: 'inspection_quote',
    visitFee: 199,
  }, { addOns: ['parts'] }), /inspection_quote supports a visit fee only/);
});
