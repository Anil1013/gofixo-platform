const HOME_SERVICE_CATALOG = Object.freeze([
  { key: 'electrician', label: 'Electrician', providerType: 'skilled_worker', imageUrl: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=700&q=82' },
  { key: 'plumber', label: 'Plumber', providerType: 'skilled_worker', imageUrl: 'https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?auto=format&fit=crop&w=700&q=82' },
  { key: 'ac_service', label: 'AC Service', providerType: 'skilled_worker', imageUrl: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=700&q=82' },
  { key: 'cleaning', label: 'Cleaning', providerType: 'general_worker', imageUrl: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=700&q=82' },
  { key: 'painter', label: 'Painter', providerType: 'skilled_worker', imageUrl: 'https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=700&q=82' },
  { key: 'carpenter', label: 'Carpenter', providerType: 'skilled_worker', imageUrl: 'https://images.unsplash.com/photo-1601058268499-e52658a84c9d?auto=format&fit=crop&w=700&q=82' },
  { key: 'appliance_repair', label: 'Appliance Repair', providerType: 'skilled_worker', imageUrl: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=700&q=82' },
  { key: 'refrigerator_repair', label: 'Refrigerator Repair', providerType: 'skilled_worker', imageUrl: 'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?auto=format&fit=crop&w=700&q=82' },
  { key: 'washing_machine_repair', label: 'Washing Machine Repair', providerType: 'skilled_worker', imageUrl: 'https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?auto=format&fit=crop&w=700&q=82' },
  { key: 'ro_water_purifier', label: 'RO & Water Purifier', providerType: 'skilled_worker', imageUrl: 'https://images.unsplash.com/photo-1584438784894-089d6a62b8fa?auto=format&fit=crop&w=700&q=82' },
  { key: 'cctv_security', label: 'CCTV & Security', providerType: 'skilled_worker', imageUrl: 'https://images.unsplash.com/photo-1557597774-9d273605dfa9?auto=format&fit=crop&w=700&q=82' },
  { key: 'internet_wifi', label: 'Internet & Wi-Fi', providerType: 'skilled_worker', imageUrl: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=700&q=82' },
  { key: 'geyser_repair', label: 'Geyser Repair', providerType: 'skilled_worker', imageUrl: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=700&q=82' },
  { key: 'pest_control', label: 'Pest Control', providerType: 'general_worker', imageUrl: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=700&q=82' },
  { key: 'packers_movers', label: 'Packers & Movers', providerType: 'general_worker', imageUrl: 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=700&q=82' },
  { key: 'salon_beauty', label: 'Salon & Beauty', providerType: 'general_worker', imageUrl: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=700&q=82' },
  { key: 'cook', label: 'Cook', providerType: 'general_worker', imageUrl: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=700&q=82' },
  { key: 'gardener', label: 'Gardener', providerType: 'general_worker', imageUrl: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=700&q=82' },
  { key: 'laundry', label: 'Laundry', providerType: 'general_worker', imageUrl: 'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&w=700&q=82' },
  { key: 'driver', label: 'Personal Driver', providerType: 'general_worker', imageUrl: 'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?auto=format&fit=crop&w=700&q=82' },
  { key: 'tutor', label: 'Tutor', providerType: 'general_worker', imageUrl: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=700&q=82' },
  { key: 'babysitter', label: 'Babysitter', providerType: 'general_worker', imageUrl: 'https://images.unsplash.com/photo-1491013516836-7db643ee125a?auto=format&fit=crop&w=700&q=82' },
  { key: 'elder_care', label: 'Elder Care', providerType: 'general_worker', imageUrl: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=700&q=82' },
  { key: 'other', label: 'Other Service', providerType: 'general_worker', imageUrl: 'https://images.unsplash.com/photo-1521791055366-0d553872125f?auto=format&fit=crop&w=700&q=82' },
]);

const HOME_SERVICE_CATEGORIES = Object.freeze(
  Object.fromEntries(HOME_SERVICE_CATALOG.map((item) => [item.key, item.label])),
);
const HOME_SERVICE_CATEGORY_KEYS = new Set(Object.keys(HOME_SERVICE_CATEGORIES));

const HOME_SERVICE_BASE_FARES = Object.freeze({
  electrician: 299,
  plumber: 299,
  ac_service: 399,
  cleaning: 349,
  painter: 499,
  carpenter: 399,
  appliance_repair: 399,
  refrigerator_repair: 449,
  washing_machine_repair: 449,
  ro_water_purifier: 349,
  cctv_security: 499,
  internet_wifi: 299,
  geyser_repair: 399,
  pest_control: 399,
  packers_movers: 799,
  salon_beauty: 499,
  cook: 499,
  gardener: 299,
  laundry: 299,
  driver: 599,
  tutor: 399,
  babysitter: 499,
  elder_care: 599,
  other: 299,
});

function getServiceBaseFare(value) {
  const key = normalizeServiceCategory(value);
  return key ? Number(HOME_SERVICE_BASE_FARES[key] || HOME_SERVICE_BASE_FARES.other) : HOME_SERVICE_BASE_FARES.other;
}

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
    security: 'cctv_security',
    cctv: 'cctv_security',
    wifi: 'internet_wifi',
    internet: 'internet_wifi',
    ro: 'ro_water_purifier',
    water_purifier: 'ro_water_purifier',
    refrigerator: 'refrigerator_repair',
    fridge: 'refrigerator_repair',
    washing_machine: 'washing_machine_repair',
    geyser: 'geyser_repair',
    driver_service: 'driver',
    home_tutor: 'tutor',
    childcare: 'babysitter',
    senior_care: 'elder_care',
  };
  const key = aliases[normalized] || normalized;
  return HOME_SERVICE_CATEGORY_KEYS.has(key) ? key : 'other';
}

function normalizeServiceCategories(values) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map(normalizeServiceCategory).filter(Boolean))];
}

function getServiceCatalog() {
  return HOME_SERVICE_CATALOG.map((item) => ({ ...item }));
}

module.exports = {
  HOME_SERVICE_CATALOG,
  HOME_SERVICE_CATEGORIES,
  HOME_SERVICE_CATEGORY_KEYS,
  normalizeServiceCategory,
  normalizeServiceCategories,
  getServiceCatalog,
  getServiceBaseFare,
};
