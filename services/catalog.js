const HOME_SERVICE_CATEGORIES = Object.freeze({
  electrician: 'Electrician',
  plumber: 'Plumber',
  ac_service: 'AC Service',
  cleaning: 'Cleaning',
  painter: 'Painter',
  carpenter: 'Carpenter',
  appliance_repair: 'Appliance Repair',
  pest_control: 'Pest Control',
  packers_movers: 'Packers & Movers',
  salon_beauty: 'Salon & Beauty',
  other: 'Other',
});

const HOME_SERVICE_CATEGORY_KEYS = new Set(Object.keys(HOME_SERVICE_CATEGORIES));

function normalizeServiceCategory(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const normalized = raw
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const aliases = {
    ac: 'ac_service',
    air_conditioning: 'ac_service',
    air_conditioner: 'ac_service',
    electrical: 'electrician',
    plumbing: 'plumber',
    paint: 'painter',
    carpentry: 'carpenter',
    appliance: 'appliance_repair',
    moving: 'packers_movers',
    packing_moving: 'packers_movers',
    beauty: 'salon_beauty',
    salon: 'salon_beauty',
  };
  const key = aliases[normalized] || normalized;
  return HOME_SERVICE_CATEGORY_KEYS.has(key) ? key : 'other';
}

function normalizeServiceCategories(values) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map(normalizeServiceCategory).filter(Boolean))];
}

module.exports = {
  HOME_SERVICE_CATEGORIES,
  HOME_SERVICE_CATEGORY_KEYS,
  normalizeServiceCategory,
  normalizeServiceCategories,
};
