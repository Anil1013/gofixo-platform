'use strict';

const PRICING_MODES = new Set([
  'fixed',
  'per_unit',
  'per_hour',
  'per_item',
  'per_kg',
  'per_sqft',
  'inspection_quote',
]);

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function positiveMoney(value, field) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) {
    throw new TypeError(`${field} must be a valid amount between 0 and 1000000`);
  }
  return roundMoney(amount);
}

function calculateServicePrice(rule, selection = {}) {
  if (!rule || typeof rule !== 'object') throw new TypeError('A pricing rule is required');
  if (!PRICING_MODES.has(rule.pricingMode)) throw new TypeError('Unsupported pricing mode');

  const mode = rule.pricingMode;
  const visitFee = positiveMoney(rule.visitFee || 0, 'visitFee');
  const minimumCharge = positiveMoney(rule.minimumCharge || 0, 'minimumCharge');
  const estimatedMinutes = Number.isInteger(rule.estimatedMinutes) && rule.estimatedMinutes >= 0
    ? rule.estimatedMinutes : null;

  if (mode === 'inspection_quote') {
    return Object.freeze({
      pricingMode: mode,
      quantity: null,
      unitLabel: rule.unitLabel || 'inspection',
      baseAmount: visitFee,
      addOnsAmount: 0,
      total: visitFee,
      estimatedMinutes,
      requiresQuote: true,
      visitFeeCreditedOnApproval: rule.creditVisitFeeOnApprovedRepair === true,
      quoteMessage: 'If you decline the repair, only the disclosed visit fee is payable. If you approve the repair during this visit, the visit fee is credited against labour. Parts and extra work require your approval.',
    });
  }

  const quantity = selection.quantity === undefined ? 1 : Number(selection.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new TypeError('quantity must be a positive number');
  }
  const min = rule.minimumQuantity === undefined ? 1 : Number(rule.minimumQuantity);
  const max = rule.maximumQuantity === undefined ? 1000 : Number(rule.maximumQuantity);
  const step = rule.quantityStep === undefined ? 1 : Number(rule.quantityStep);
  if (![min, max, step].every(Number.isFinite) || min <= 0 || max < min || step <= 0) {
    throw new TypeError('Pricing rule has invalid quantity limits');
  }
  if (quantity < min || quantity > max) {
    throw new RangeError(`quantity must be between ${min} and ${max}`);
  }
  const steps = (quantity - min) / step;
  if (Math.abs(steps - Math.round(steps)) > 1e-9) {
    throw new RangeError(`quantity must follow increments of ${step}`);
  }

  let selectedVariant = null;
  if (Array.isArray(rule.variants) && rule.variants.length) {
    const variantKey = selection.variantKey;
    selectedVariant = rule.variants.find((item) => item && item.key === variantKey);
    if (!selectedVariant) throw new TypeError('Select a valid service package or size');
  }
  const unitPrice = selectedVariant
    ? positiveMoney(selectedVariant.price, 'variant.price')
    : positiveMoney(rule.unitPrice, 'unitPrice');
  const rawBase = selectedVariant || mode === 'fixed' ? unitPrice : unitPrice * quantity;
  const baseAmount = roundMoney(Math.max(minimumCharge, rawBase) + visitFee);

  const allowedAddOns = new Map((Array.isArray(rule.addOns) ? rule.addOns : [])
    .filter((item) => item && typeof item.key === 'string')
    .map((item) => [item.key, item]));
  const requestedAddOns = Array.isArray(selection.addOns) ? selection.addOns : [];
  const seen = new Set();
  let addOnsAmount = 0;
  const addOnLines = [];

  for (const requested of requestedAddOns) {
    const key = typeof requested === 'string' ? requested : requested?.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const addOn = allowedAddOns.get(key);
    if (!addOn) throw new TypeError(`Unknown add-on: ${key}`);
    const price = positiveMoney(addOn.price, `addOn(${key}).price`);
    const addOnQuantity = requested && typeof requested === 'object' && requested.quantity !== undefined
      ? Number(requested.quantity) : 1;
    if (!Number.isFinite(addOnQuantity) || addOnQuantity <= 0 || addOnQuantity > 1000) {
      throw new TypeError(`Add-on quantity for ${key} must be between 0 and 1000`);
    }
    const lineTotal = roundMoney(price * addOnQuantity);
    addOnsAmount = roundMoney(addOnsAmount + lineTotal);
    addOnLines.push(Object.freeze({ key, quantity: addOnQuantity, unitPrice: price, total: lineTotal }));
  }

  return Object.freeze({
    pricingMode: mode,
    quantity,
    unitLabel: selectedVariant?.unitLabel || rule.unitLabel || 'service',
    variantKey: selectedVariant?.key || null,
    variantLabel: selectedVariant?.label || null,
    baseAmount,
    addOnsAmount,
    addOnLines: Object.freeze(addOnLines),
    total: roundMoney(baseAmount + addOnsAmount),
    estimatedMinutes,
    requiresQuote: false,
  });
}

module.exports = { PRICING_MODES, roundMoney, calculateServicePrice };
