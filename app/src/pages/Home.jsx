import { useEffect, useRef, useState } from 'react';
import { apiPost } from '../api';
import MapView from '../components/MapView';
import { reverseGeocodeDetails, reverseGeocode, searchAddress, getRoute, formatDistance } from '../utils/geo';

const RIDE_TYPES = [
  { value: 'bike', label: 'Bike' },
  { value: 'auto', label: 'Auto' },
  { value: 'car', label: 'Car' },
];

const HOME_SERVICE_TYPES = [
  { value: 'general_worker', label: 'Home help (cleaning, general)' },
  { value: 'skilled_worker', label: 'Skilled (electrician, plumber, carpenter)' },
];

const FARE_RULES = {
  bike: { base: 30, perKm: 10, minimum: 40 },
  auto: { base: 40, perKm: 14, minimum: 50 },
  car: { base: 60, perKm: 18, minimum: 70 },
};

const LOCATION_PROMPTED_KEY = 'gofixo_location_prompted';

function calculateFare(type, distanceKm) {
  const rule = FARE_RULES[type];
  if (!rule || !Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  return Math.max(rule.minimum, Math.round(rule.base + distanceKm * rule.perKm));
}

export default function Home({ onBooked }) {
  const [category, setCategory] = useState('ride'); // ride | services
  const [providerType, setProviderType] = useState('bike');
  const [location, setLocation] = useState('');
  const [work, setWork] = useState('');
  const [coords, setCoords] = useState(null);\n  const [pickupPincode, setPickupPincode] = useState('');\n  const [dropPincode, setDropPincode] = useState('');
  const [destination, setDestination] = useState('');
  const [destCoords, setDestCoords] = useState(null);
  const [route, setRoute] = useState(null);
  const [pickupFinding, setPickupFinding] = useState(false);
  const [locating, setLocating] = useState(false);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const locationRequestRef = useRef(false);
  const destinationResolvedRef = useRef('');

  async function applyCurrentLocation(pos) {
    const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setCoords(here);
    setLocating(false);

    // Keep the coordinates even if reverse geocoding is temporarily unavailable.
    const address = await reverseGeocode(here.lat, here.lng);
    setLocation(address || 'Current location');

    if (destCoords) {
      const nextRoute = await getRoute(here, destCoords);
      setRoute(nextRoute);
    }
  }

  function requestCurrentLocation({ interactive = false } = {}) {
    if (locationRequestRef.current) return;
    locationRequestRef.current = true;
    setLocating(true);
    setError('');

    if (!navigator.geolocation) {
      setError('Location is not available on this device/browser.');
      setLocating(false);
      locationRequestRef.current = false;
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        localStorage.setItem(LOCATION_PROMPTED_KEY, '1');
        await applyCurrentLocation(pos);
        locationRequestRef.current = false;
      },
      () => {
        setLocating(false);
        locationRequestRef.current = false;
        if (interactive) {
          setError('Could not get your location. Please allow location access in phone/browser settings.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }

  function useMyLocation() {
    requestCurrentLocation({ interactive: true });
  }

  useEffect(() => {
    // Browser/phone permission is persistent. Only request it automatically once.
    // After permission is granted, future Home loads silently read the current GPS
    // position without showing the permission dialog again.
    if (!navigator.geolocation) return;

    const prompted = localStorage.getItem(LOCATION_PROMPTED_KEY) === '1';

    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((permission) => {
        if (permission.state === 'granted') {
          requestCurrentLocation();
        } else if (permission.state === 'prompt' && !prompted) {
          localStorage.setItem(LOCATION_PROMPTED_KEY, '1');
          requestCurrentLocation();
        }
      }).catch(() => {
        if (!prompted) {
          localStorage.setItem(LOCATION_PROMPTED_KEY, '1');
          requestCurrentLocation();
        }
      });
    } else if (!prompted) {
      localStorage.setItem(LOCATION_PROMPTED_KEY, '1');
      requestCurrentLocation();
    }
  }, []);

  async function findPickup() {
    setError('');
    if (!location.trim()) return;
    setPickupFinding(true);
    const found = await searchAddress(location);
    if (!found) {
      setError('Could not find the pickup address — try adding the area or city name.');
      setPickupFinding(false);
      return;
    }
    const pickup = { lat: found.lat, lng: found.lng };
    setLocation(found.label);
    setCoords(pickup);
    if (destCoords) setRoute(await getRoute(pickup, destCoords));
    setPickupFinding(false);
  }

  async function findDestination() {
    const query = destination.trim();
    if (!query || query === destinationResolvedRef.current) return;

    setError('');
    setFinding(true);
    const found = await searchAddress(query);
    if (!found) {
      setError('Could not find that place — try adding the area or city name.');
      setFinding(false);
      return;
    }

    setDestination(found.label);
    destinationResolvedRef.current = query;
    setDestCoords({ lat: found.lat, lng: found.lng });
    setRoute(coords ? await getRoute(coords, found) : null);
    setFinding(false);
  }

  async function book() {
    setError('');
    if (!coords) {
      setError('Please allow location access so we can use your current pickup location.');
      return;
    }
    if (!location) {
      setError('Please confirm your pickup location.');
      return;
    }
    setLoading(true);
    try {
      let resolvedDestination = destCoords;
      let resolvedRoute = route;

      // If the user types a drop address and immediately taps Book,
      // resolve it here as well so booking never depends on the blur event finishing first.
      if (category === 'ride' && (!resolvedDestination || !resolvedRoute)) {
        const query = destination.trim();
        if (!query) {
          setError('Please enter a drop location.');
          return;
        }
        setFinding(true);
        const found = await searchAddress(query);
        setFinding(false);
        if (!found) {
          setError('Could not find that place — try adding the area or city name.');
          return;
        }
        resolvedDestination = { lat: found.lat, lng: found.lng };
        resolvedRoute = await getRoute(coords, found);
        setDestination(found.label);
        destinationResolvedRef.current = query;
        setDestCoords(resolvedDestination);
        setRoute(resolvedRoute);
      }

      if (category === 'ride' && (!resolvedDestination || !resolvedRoute)) {
        setError('Please enter a valid drop location so we can calculate the fare.');
        return;
      }

      const body = {
        service_type: category,
        provider_type: providerType,
        pickup_location: location,
        drop_or_service_address: category === 'services' ? work : destination,
        pickup_lat: coords.lat,
        pickup_lng: coords.lng,
        drop_lat: category === 'ride' ? resolvedDestination.lat : undefined,
        drop_lng: category === 'ride' ? resolvedDestination.lng : undefined,
        route_distance_km: category === 'ride' ? resolvedRoute.distanceKm : undefined,
        estimated_fare: category === 'ride' ? calculateFare(providerType, resolvedRoute.distanceKm) : undefined,
      };
      const booking = await apiPost('/bookings', body, true);
      onBooked(booking);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const types = category === 'ride' ? RIDE_TYPES : HOME_SERVICE_TYPES;
  const estimatedFare = category === 'ride' && route ? calculateFare(providerType, route.distanceKm) : null;

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
        <button className={category === 'services' ? 'active' : ''} onClick={() => { setCategory('services'); setProviderType('general_worker'); }}>
          🔧 Home Services
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
        {locating ? 'Getting location...' : coords ? '📍 Current location detected — tap to refresh' : '📍 Use my current location'}
      </button>

      {coords && <MapView markers={markers} line={route ? route.line : null} height={190} />}

      <label>{category === 'ride' ? 'Pickup address' : 'Service address'}</label>
      <div className="find-row">
        <input
          value={location}
          onChange={(e) => {
            setLocation(e.target.value);
            setCoords(null);
            setRoute(null);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && category === 'ride') findPickup(); }}
          placeholder="Your current location"
        />
        {category === 'ride' && <button type="button" onClick={findPickup} disabled={pickupFinding}>{pickupFinding ? '...' : 'Find'}</button>}
      </div>
      <input value={pickupPincode} onChange={(e) => setPickupPincode(e.target.value)} placeholder="PIN code" />

      {category === 'ride' && (
        <>
          <label>Where to?</label>
          <div className="find-row">
            <input
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                destinationResolvedRef.current = '';
                setDestCoords(null);
                setRoute(null);
              }}
              onBlur={findDestination}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); findDestination(); } }}
              placeholder="Enter drop location, e.g. Cyber Hub, Gurgaon"
            />
            <button type="button" onClick={findDestination} disabled={finding}>{finding ? '...' : 'Find'}</button>
          </div>
          <input value={dropPincode} onChange={(e) => setDropPincode(e.target.value)} placeholder="PIN code" />
          {route && (
            <>
              <p className="route-info">🛣 {formatDistance(route.distanceKm)} · about {route.durationMin} min</p>
              <div className="fare-card"><span>Estimated fare</span><strong>₹{estimatedFare}</strong></div>
            </>
          )}
        </>
      )}

      {category === 'services' && (
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
