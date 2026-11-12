'use strict';

const MAX_AMOUNT = 1000000;
function amount(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) throw new TypeError(`${field} must be between 0 and 1000000`);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function buildServiceQuote(input, visitFeeAmount = 0) {
  if (!input || typeof input !== 'object') throw new TypeError('Quote details are required');
  const labourAmount = amount(input.labourAmount, 'labourAmount');
  const visitFee = amount(visitFeeAmount, 'visitFeeAmount');
  const creditVisitFee = input.creditVisitFee === true;
  const visitFeeCreditAmount = creditVisitFee ? Math.min(labourAmount, visitFee) : 0;
  const serviceAmount = Math.round((labourAmount - visitFeeCreditAmount + Number.EPSILON) * 100) / 100;
  if (serviceAmount <= 0) throw new RangeError('Labour amount must remain positive (greater than zero) after any visit-fee credit');
  const rawItems = input.materials === undefined ? [] : input.materials;
  if (!Array.isArray(rawItems) || rawItems.length > 50) throw new TypeError('materials must be an array with at most 50 items');
  const seen = new Set();
  const materials = rawItems.map((item, index) => {
    const name = String(item?.name || '').trim();
    if (!name || name.length > 120) throw new TypeError(`materials[${index}].name is required and must be at most 120 characters`);
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) throw new TypeError(`materials[${index}].quantity must be between 0 and 1000`);
    const unitPrice = amount(item.unitPrice, `materials[${index}].unitPrice`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new TypeError('Duplicate material names are not allowed');
    seen.add(key);
    return Object.freeze({ name, quantity, unitPrice, total: Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100 });
  });
  const materialsAmount = Math.round((materials.reduce((sum, item) => sum + item.total, 0) + Number.EPSILON) * 100) / 100;
  const description = String(input.description || '').trim();
  if (!description || description.length > 1000) throw new TypeError('description is required and must be at most 1000 characters');
  const totalAmount = Math.round((serviceAmount + materialsAmount + Number.EPSILON) * 100) / 100;
  if (totalAmount <= 0 || totalAmount > MAX_AMOUNT) throw new TypeError('Quote total must be greater than zero and at most 1000000');
  return Object.freeze({
    description, labourAmount, visitFeeAmount: visitFee, visitFeeCreditAmount,
    serviceAmount, materialsAmount, totalAmount, materials: Object.freeze(materials),
  });
}
module.exports = { buildServiceQuote };
