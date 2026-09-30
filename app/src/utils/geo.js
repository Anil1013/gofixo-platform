// Free, key-less location services (OpenStreetMap ecosystem):
//  - Nominatim  : address <-> coordinates   (fair-use: ~1 request/sec, so search runs on an explicit tap, never per keystroke)
//  - OSRM       : route line, distance, ETA (public demo server — fine for a pilot; self-host or switch provider at scale)
// If traffic grows, only this file needs to change to move to Mapbox / HERE / Google.

export async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`,
      { headers: { 'Accept-Language': 'en' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch {
    return null;
  }
}

export async function reverseGeocodeDetails(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { 'Accept-Language': 'en-IN,en' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { label: data.display_name || '', address: data.address || {} };
  } catch {
    return null;
  }
}

export async function searchAddressSuggestions(query, near = null) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '6');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', 'in');
  url.searchParams.set('q', raw);
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lng)) {
    url.searchParams.set('viewbox', [near.lng - 0.35, near.lat + 0.35, near.lng + 0.35, near.lat - 0.35].join(','));
  }
  try {
    const res = await fetch(url.toString(), { headers: { 'Accept-Language': 'en-IN,en' } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data.map((item) => {
      const lat = Number(item.lat);
      const lng = Number(item.lon);
      return Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng, label: item.display_name, address: item.address || {} } : null;
    }).filter(Boolean) : [];
  } catch { return []; }
}

export function getAddressParts(address = {}) {
  return {
    houseNumber: address.house_number || address.house || '',
    street: address.road || address.pedestrian || address.footway || '',
    area: address.neighbourhood || address.suburb || address.quarter || '',
    locality: address.city_district || address.city || address.town || address.village || '',
    pincode: address.postcode || '',
    state: address.state || '',
    landmark: address.amenity || address.building || address.shop || '',
  };
}

export function formatStructuredAddress(parts = {}) {
  return [parts.houseNumber, parts.street, parts.area, parts.locality, parts.pincode, parts.state].filter(Boolean).join(', ');
}

export async function searchAddress(query) {
  const raw = String(query || '').trim();
  if (!raw) return null;

  // Nominatim is good for addresses, but exact spelling can be fragile.
  // Try the user's text first, then a few safe India/Gurgaon variants.
  const normalized = raw
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  const variants = [];
  const add = (value) => {
    const v = String(value || '').trim();
    if (v && !variants.includes(v)) variants.push(v);
  };

  add(normalized);
  add(normalized.replace(/\bakshneem\b/gi, 'Akashneem'));
  add(normalized.replace(/\bakashneem\b/gi, 'Akshneem'));
  add(normalized.replace(/\bgurgaon\b/gi, 'Gurugram'));
  add(normalized.replace(/\bgurugram\b/gi, 'Gurgaon'));
  add(normalized.replace(/\bakshneem\b/gi, 'Akashneem').replace(/\bgurgaon\b/gi, 'Gurugram'));
  add(normalized.replace(/\bakashneem\b/gi, 'Akshneem').replace(/\bgurgaon\b/gi, 'Gurgaon'));

  // If the user gives a Gurgaon-style short address, explicitly add India.
  if (/\b(gurgaon|gurugram)\b/i.test(normalized) && !/\bindia\b/i.test(normalized)) {
    add(normalized + ', India');
  }

  for (let i = 0; i < variants.length; i += 1) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&countrycodes=in&q=${encodeURIComponent(variants[i])}`,
        { headers: { 'Accept-Language': 'en' } }
      );
      if (!res.ok) continue;

      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        // Prefer a result that contains the requested road/place words.
        const words = normalized.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
        const best = [...data].sort((a, b) => {
          const aText = String(a.display_name || '').toLowerCase();
          const bText = String(b.display_name || '').toLowerCase();
          const score = (text) => words.reduce((n, word) => n + (text.includes(word) ? 1 : 0), 0);
          return score(bText) - score(aText);
        })[0];

        const lat = Number(best.lat);
        const lng = Number(best.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat, lng, label: best.display_name };
        }
      }
    } catch {
      // Try the next normalized variant.
    }

    // Nominatim's public service asks clients to keep request rates low.
    if (i < variants.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  }

  return null;
}

export async function getRoute(from, to) {
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route) return null;
    return {
      distanceKm: route.distance / 1000,
      durationMin: Math.max(1, Math.round(route.duration / 60)),
      line: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    };
  } catch {
    return null;
  }
}

export function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// Free turn-by-turn navigation: opens the Google Maps app/site (no API key involved)
export function navigateToCoords(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

export function navigateToText(text) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(text)}&travelmode=driving`;
}
