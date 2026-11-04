'use strict';

function money(value, field) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) {
    throw new TypeError(`${field} must be between 0 and 1000000`);
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Splits the approved labour/service charge. Approved material reimbursements
 * are passed through to the partner at cost and are not commissionable.
 */
function calculateServiceSettlement({
  serviceAmount,
  partnerPercent,
  approvedMaterialAmount = 0,
  minimumPartnerServiceEarning = 0,
}) {
  const service = money(serviceAmount, 'serviceAmount');
  const materials = money(approvedMaterialAmount, 'approvedMaterialAmount');
  const floor = money(minimumPartnerServiceEarning, 'minimumPartnerServiceEarning');
  const share = Number(partnerPercent);

  if (!Number.isFinite(share) || share < 0 || share > 100) {
    throw new TypeError('partnerPercent must be between 0 and 100');
  }

  const partnerServiceEarning = Math.round((service * share / 100 + Number.EPSILON) * 100) / 100;
  if (partnerServiceEarning < floor) {
    throw new RangeError('This price does not meet the configured minimum partner earning');
  }
  const platformCommission = Math.round((service - partnerServiceEarning + Number.EPSILON) * 100) / 100;
  const partnerTotal = Math.round((partnerServiceEarning + materials + Number.EPSILON) * 100) / 100;
  const customerTotalBeforeTax = Math.round((service + materials + Number.EPSILON) * 100) / 100;

  return Object.freeze({
    serviceAmount: service,
    partnerServiceEarning,
    platformCommission,
    approvedMaterialAmount: materials,
    partnerTotal,
    customerTotalBeforeTax,
    platformCommissionPercent: service === 0 ? 0 : Math.round((platformCommission / service) * 10000) / 100,
  });
}

module.exports = { calculateServiceSettlement };
