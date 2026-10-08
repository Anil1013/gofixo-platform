const RIDE_FARE_RULES = Object.freeze({
  bike: { base: 30, minimum: 30, slabs: [[10, 6], [20, 5.5], [30, 5], [50, 4.5], [Infinity, 4.5]] },
  auto: { base: 40, minimum: 40, slabs: [[10, 7.5], [20, 6.5], [30, 6], [50, 5.5], [Infinity, 5.5]] },
  car: { base: 60, minimum: 60, slabs: [[10, 9.5], [20, 9], [30, 8], [50, 6.5], [100, 5], [Infinity, 2.5]] },
});

function calculateRideFare(providerType, distanceKm) {
  const rule = RIDE_FARE_RULES[providerType];
  const km = Number(distanceKm);
  if (!rule || !Number.isFinite(km) || km <= 0) {
    throw new Error('Invalid ride pricing input');
  }

  let remaining = km;
  let previous = 0;
  let distanceFare = 0;

  for (const [limit, rate] of rule.slabs) {
    const slabKm = Math.max(0, Math.min(remaining, limit - previous));
    if (slabKm > 0) distanceFare += slabKm * rate;
    remaining -= slabKm;
    previous = limit;
    if (remaining <= 0) break;
  }

  return Math.max(rule.minimum, Math.round(rule.base + distanceFare));
}

module.exports = { RIDE_FARE_RULES, calculateRideFare };
