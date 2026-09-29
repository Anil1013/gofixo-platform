import { useState } from 'react';
import { apiPost } from '../api';
import MapView from '../components/MapView';
import { reverseGeocode, searchAddress, getRoute, formatDistance } from '../utils/geo';

const RIDE_TYPES = [
  { value: 'bike', label: 'Bike' },
  { value: 'auto', label: 'Auto' },
  { value: 'car', label: 'Car' },
];

const PRONTO_TYPES = [
  { value: 'general_worker', label: 'Home help (cleaning, general)' },
  { value: 'skilled_worker', label: 'Skilled (electrician, plumber, carpenter)' },
];

export default function Home({ onBooked }) {
  const [category, setCategory] = useState('ride'); // ride | pronto
  const [providerType, setProviderType] = useState('bike');
  const [location, setLocation] = useState('');
  const [work, setWork] = useState('');
  const [coords, setCoords] = useState(null);
  const [destination, setDestination] = useState('');
  const [destCoords, setDestCoords] = useState(null);
  const [route, setRoute] = useState(null);
  const [locating, setLocating] = useState(false);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function useMyLocation() {
    setLocating(true);
    setError('');
    if (!navigator.geolocation) {
      setError('Location is not available on this device/browser.');
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(here);
        setLocating(false);
        // Turn coordinates into a readable address (fills the box, still editable)
        const address = await reverseGeocode(here.lat, here.lng);
        if (address) setLocation(address);
        if (destCoords) setRoute(await getRoute(here, destCoords));
      },
      () => {
        setError('Could not get your location. Please allow location access.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function findDestination() {
    setError('');
    if (!destination.trim()) return;
    if (!coords) {
      setError('Share your location first, then find the destination.');
      return;
    }
    setFinding(true);
    const found = await searchAddress(destination);
    if (!found) {
      setError('Could not find that place — try adding the area or city name.');
      setFinding(false);
      return;
    }
    setDestination(found.label);
    setDestCoords({ lat: found.lat, lng: found.lng });
    setRoute(await getRoute(coords, found));
    setFinding(false);
  }

  async function book() {
    setError('');
    if (!coords) {
      setError('Please share your location first.');
      return;
    }
    if (!location) {
      setError('Please confirm your pickup location.');
      return;
    }
    setLoading(true);
    try {
      const body = {
        service_type: category,
        provider_type: providerType,
        pickup_location: location,
        drop_or_service_address: category === 'pronto' ? work : destination || undefined,
        pickup_lat: coords.lat,
        pickup_lng: coords.lng,
      };
      const booking = await apiPost('/bookings', body, true);
      onBooked(booking);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const types = category === 'ride' ? RIDE_TYPES : PRONTO_TYPES;

  const markers = [];
  if (coords) markers.push({ lat: coords.lat, lng: coords.lng, emoji: '📍', color: '#EC4899' });
  if (category === 'ride' && destCoords) markers.push({ lat: destCoords.lat, lng: destCoords.lng, emoji: '🏁', color: '#14B8A6' });

  return (
    <div className="screen">
      <h2>Book a service</h2>

      <div className="tab-switch">
        <button className={category === 'ride' ? 'active' : ''} onClick={() => { setCategory('ride'); setProviderType('bike'); }}>
          🏍 Ride
        </button>
        <button className={category === 'pronto' ? 'active' : ''} onClick={() => { setCategory('pronto'); setProviderType('general_worker'); }}>
          🔧 Pronto (home service)
        </button>
      </div>

      <div className="type-grid">
        {types.map((t) => (
          <button key={t.value} className={providerType === t.value ? 'type-chip active' : 'type-chip'} onClick={() => setProviderType(t.value)}>
            {t.label}
          </button>
        ))}
      </div>

      <button type="button" className="secondary" style={{ marginTop: 0 }} onClick={useMyLocation} disabled={locating}>
        {locating ? 'Getting location...' : coords ? '📍 Location shared — tap to refresh' : '📍 Use my current location'}
      </button>

      {coords && <MapView markers={markers} line={route ? route.line : null} height={190} />}

      <label>{category === 'ride' ? 'Pickup address' : 'Service address'}</label>
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Filled automatically from your location — you can edit it" />

      {category === 'ride' && (
        <>
          <label>Where to? (optional)</label>
          <div className="find-row">
            <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. Cyber Hub, Gurgaon" />
            <button type="button" onClick={findDestination} disabled={finding}>{finding ? '...' : 'Find'}</button>
          </div>
          {route && (
            <p className="route-info">
              🛣 {formatDistance(route.distanceKm)} · about {route.durationMin} min
            </p>
          )}
        </>
      )}

      {category === 'pronto' && (
        <>
          <label>What do you need done?</label>
          <input value={work} onChange={(e) => setWork(e.target.value)} placeholder="e.g. Deep cleaning, 2BHK" />
        </>
      )}

      {error && <p className="auth-error">{error}</p>}

      <button className="cta" onClick={book} disabled={loading}>
        {loading ? 'Finding nearest provider...' : `Book ${category === 'ride' ? 'ride' : 'service'}`}
      </button>
    </div>
  );
}
