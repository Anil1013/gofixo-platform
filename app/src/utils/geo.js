const API_BASE = 'https://gofixo.mob13r.com/api';

let placesSessionToken = null;

function newPlacesSession() {
  placesSessionToken = globalThis.crypto?.randomUUID?.() || (
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
  );
  return placesSessionToken;
}

function currentPlacesSession() {
  return placesSessionToken || newPlacesSession();
}

export function resetPlacesSession() {
  placesSessionToken = null;
}

async function apiJson(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Location request failed (${res.status})`);
  return data;
}

export async function reverseGeocode(lat, lng) {
  try {
    const data = await apiJson(
      `/places/resolve?input=${encodeURIComponent(`${lat}, ${lng}`)}`
    );
    return data.place?.address || data.place?.name || null;
  } catch {
    return null;
  }
}

export async function reverseGeocodeDetails(lat, lng) {
  const label = await reverseGeocode(lat, lng);
  return label ? { label, address: {} } : null;
}

export async function searchAddressSuggestions(query, near = null) {
  const raw = String(query || '').trim();
  if (raw.length < 2) return [];

  try {
    const params = new URLSearchParams({
      input: raw,
      sessionToken: currentPlacesSession(),
    });
    const data = await apiJson(`/places/autocomplete?${params.toString()}`);

    // Query predictions do not contain a Place ID, so keep only selectable
    // place predictions in the UI. A typed query can still be resolved on Find.
    return (Array.isArray(data.suggestions) ? data.suggestions : [])
      .filter((item) => item.type === 'place' && item.placeId)
      .map((item) => ({
        placeId: item.placeId,
        label: item.text || item.mainText || '',
        mainText: item.mainText || item.text || '',
        secondaryText: item.secondaryText || '',
      }))
      .filter((item) => item.label);
  } catch {
    return [];
  }
}

export async function getPlaceDetails(placeId) {
  const token = currentPlacesSession();
  try {
    const data = await apiJson(
      `/places/details/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(token)}`
    );
    resetPlacesSession();
    return {
      lat: Number(data.lat),
      lng: Number(data.lng),
      label: data.address || data.name || '',
      address: data.address || '',
      placeId: data.placeId || placeId,
    };
  } catch (error) {
    resetPlacesSession();
    throw error;
  }
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
  return [parts.houseNumber, parts.street, parts.area, parts.locality, parts.pincode, parts.state]
    .filter(Boolean)
    .join(', ');
}

export async function searchAddress(query) {
  const raw = String(query || '').trim();
  if (!raw) return null;

  try {
    const data = await apiJson(`/places/resolve?input=${encodeURIComponent(raw)}`);
    const place = data.place;
    if (!place || !Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lng))) {
      return null;
    }
    return {
      lat: Number(place.lat),
      lng: Number(place.lng),
      label: place.address || place.name || raw,
      address: place.address || '',
      placeId: place.placeId || '',
    };
  } catch {
    return null;
  }
}

export async function getRoute(from, to) {
  if (!from || !to) return null;

  try {
    const data = await apiJson('/routes/compute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: Number(from.lat), lng: Number(from.lng) },
        destination: { lat: Number(to.lat), lng: Number(to.lng) },
      }),
    });

    const distanceMeters = Number(data.distanceMeters);
    const durationSeconds = Number(data.durationSeconds);
    const encoded = String(data.encodedPolyline || '');
    const line = decodeGooglePolyline(encoded);

    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0 || line.length < 2) return null;

    return {
      distanceKm: distanceMeters / 1000,
      durationMin: Math.max(1, Math.round(durationSeconds / 60)),
      line,
      fallback: false,
    };
  } catch {
    return null;
  }
}

function decodeGooglePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;

    do {
      if (index >= encoded.length) return points;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;

    do {
      if (index >= encoded.length) return points;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
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
