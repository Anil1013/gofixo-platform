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

const RIDE_VISUALS = {
  bike: { image: 'https://images.unsplash.com/photo-1733565823567-ca12618dec46?auto=format&fit=crop&w=900&q=82', title: 'Bike', sub: 'Fast & affordable', tone: 'orange' },
  auto: { image: 'https://images.unsplash.com/photo-1703142488992-72018a83fd8a?auto=format&fit=crop&w=900&q=82', title: 'Auto', sub: 'Comfortable rides', tone: 'green' },
  car: { image: 'https://images.unsplash.com/photo-1558594924-32c0320a116e?auto=format&fit=crop&w=900&q=82', title: 'Car', sub: 'Premium & safe', tone: 'blue' },
};

const SERVICE_VISUALS = {
  general_worker: { image: 'https://www.trueprocleaners.com/imgs/oc-house-cleaning-european-01.webp', title: 'Home Help', sub: 'Cleaning & everyday help', tone: 'orange' },
  skilled_worker: { image: 'https://gigswala.com/assets/electrician-india-CsTyPjpS.png', title: 'Skilled Expert', sub: 'Electrician, plumber & more', tone: 'blue' },
};

const HOME_SERVICE_CARDS = [
  { label: 'Electrician', type: 'skilled_worker', image: 'https://eletricistagravatai.com.br/images/eletricista-24h-perto-de-voce-em-gravatai-rs.jpeg' },
  { label: 'Plumber', type: 'skilled_worker', image: 'https://handymanpalmbayfl.com/images/plumbing_service_2.webp' },
  { label: 'AC Service', type: 'skilled_worker', image: 'https://imagedelivery.net/xaKlCos5cTg_1RWzIu_h-A/63023f11-6fa4-41a7-ca68-748ee14fc600/public' },
  { label: 'Cleaning', type: 'general_worker', image: 'https://www.trueprocleaners.com/imgs/oc-house-cleaning-european-01.webp' },
  { label: 'Carpenter', type: 'skilled_worker', image: 'https://images.unsplash.com/photo-1756736668332-e921516c1305?auto=format&fit=crop&w=700&q=82' },
  { label: 'Home Repair', type: 'skilled_worker', image: 'https://manitasenbarcelona.com/images/sobre-nosotros-manitas-barcelona.jpg' },
  { label: 'Appliance Repair', type: 'skilled_worker', image: 'https://www.trueprocleaners.com/imgs/oc-house-cleaning-european-01.webp' },
  { label: 'More', type: 'general_worker', image: 'https://allhomerepairs247.com/images/woman-ipad-red.webp' },
];

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
  const [coords, setCoords] = useState(null);
  const [pickupPincode, setPickupPincode] = useState('');
  const [pickupArea, setPickupArea] = useState('');
  const [pickupStreet, setPickupStreet] = useState('');
  const [pickupHouse, setPickupHouse] = useState('');
  const [dropPincode, setDropPincode] = useState('');
  const [dropArea, setDropArea] = useState('');
  const [dropStreet, setDropStreet] = useState('');
  const [dropHouse, setDropHouse] = useState('');
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
    if (String(pickupPincode).length !== 6) {
      setError('Please confirm the 6-digit pickup PIN code.');
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
      if (category === 'ride' && String(dropPincode).length !== 6) {
        setError('Please confirm the 6-digit drop PIN code.');
        return;
      }

      const body = {
        service_type: category,
        provider_type: providerType,
        pickup_location: [location, pickupHouse, pickupStreet, pickupArea, pickupPincode].filter(Boolean).join(', '),
        drop_or_service_address: category === 'services' ? work : [destination, dropHouse, dropStreet, dropArea, dropPincode].filter(Boolean).join(', '),
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
    <div className="screen home-screen">
      <header className="customer-app-header">
        <div className="customer-logo"><span className="customer-logo-pin" /><strong>Gofi<span>xo</span></strong></div>
        <div className="customer-header-actions"><span className="notification-dot">●</span><span className="customer-avatar-mini">👤</span></div>
      </header>

      <section className="customer-reference-hero">
        <div>
          <span className="customer-hero-kicker">RIDE · DELIVERY · HOME SERVICES</span>
          <h1>Your City<br /><span>Your Services</span></h1>
          <p>Rides, Home Services<br />and more — All in One App</p>
        </div>
        <div className="reference-vehicle-strip">
          {RIDE_TYPES.map((t) => {
            const visual = RIDE_VISUALS[t.value];
            return (
              <button type="button" key={t.value} onClick={() => { setCategory('ride'); setProviderType(t.value); }}>
                <img src={visual.image} alt="" />
                <b>{visual.title}</b>
              </button>
            );
          })}
        </div>
      </section>

      <button type="button" className="reference-location-search" onClick={useMyLocation}>
        <span>⌖</span><strong>{location || 'Where are you going?'}</strong><i>◎</i>
      </button>
      <section className="home-hero">
        <div className="home-hero-copy">
          <div className="home-brand-row">
            <span className="home-logo-mark">G</span>
            <span>Gofixo</span>
          </div>
          <p className="home-eyebrow">YOUR CITY · YOUR SERVICES</p>
          <h1>Your City<br /><span>Your Services</span></h1>
          <p className="home-hero-text">Rides, home services and more — all in one simple app.</p>
          <div className="home-trust-row">
            <span>✓ Verified</span>
            <span>✓ Fair pricing</span>
            <span>✓ Local experts</span>
          </div>
        </div>
        <div className="home-hero-visual">
          <img
            src={(category === 'ride' ? RIDE_VISUALS[providerType] : SERVICE_VISUALS[providerType])?.image || '/illustrations/worker.svg'}
            alt=""
          />
          <div className="hero-float-card">
            <strong>{category === 'ride' ? 'Nearby rides' : 'Trusted experts'}</strong>
            <span>{category === 'ride' ? 'Ready when you are' : 'At your doorstep'}</span>
          </div>
        </div>
      </section>

      <div className="home-section-heading">
        <div>
          <span className="section-kicker">{category === 'ride' ? 'GOFIXO RIDES' : 'GOFIXO SERVICES'}</span>
          <h2>{category === 'ride' ? 'Book a Ride' : 'Home Services'}</h2>
        </div>
        <span className="live-dot">● Available</span>
      </div>

      <div className="home-category-switch">
        <button type="button" className={category === 'ride' ? 'active' : ''} onClick={() => { setCategory('ride'); setProviderType('bike'); }}>
          <span>🚕</span> Rides
        </button>
        <button type="button" className={category === 'services' ? 'active' : ''} onClick={() => { setCategory('services'); setProviderType('general_worker'); }}>
          <span>🏠</span> Services
        </button>
      </div>

      <div className="visual-type-grid">
        {types.map((t) => {
          const visual = category === 'ride' ? RIDE_VISUALS[t.value] : SERVICE_VISUALS[t.value];
          return (
            <button
              type="button"
              key={t.value}
              className={providerType === t.value ? `visual-type-card selected ${visual.tone}` : `visual-type-card ${visual.tone}`}
              onClick={() => setProviderType(t.value)}
            >
              <img src={visual.image} alt="" />
              <span className="visual-type-name">{visual.title}</span>
              <span className="visual-type-sub">{visual.sub}</span>
              {providerType === t.value && <span className="selected-check">✓</span>}
            </button>
          );
        })}
      </div>

      {category === 'services' && (
        <div className="popular-services">
          <div className="mini-section-title">Popular services</div>
          <div className="service-pills">
            {HOME_SERVICE_CARDS.map((item) => (
              <button type="button" key={item.label} onClick={() => { setProviderType(item.type); setWork(item.label); }}>
                <img src={item.image} alt="" loading="lazy" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <section className="booking-panel">
        <div className="booking-panel-head">
          <div>
            <span className="section-kicker">{category === 'ride' ? 'BOOK A RIDE' : 'BOOK HOME HELP'}</span>
            <h2>{category === 'ride' ? 'Where are you going?' : 'Tell us what you need'}</h2>
          </div>
          <span className="secure-badge">🔒 Safe</span>
        </div>

        <button type="button" className="location-card" onClick={useMyLocation} disabled={locating}>
          <span className="location-icon">⌖</span>
          <span className="location-copy">
            <strong>{locating ? 'Getting your location…' : coords ? 'Current location detected' : 'Use my current location'}</strong>
            <small>{location || 'Tap to detect your pickup / service address'}</small>
          </span>
          <span className="location-arrow">›</span>
        </button>

        {coords && (
          <div className="map-shell">
            <MapView markers={markers} line={route ? route.line : null} height={180} />
          </div>
        )}

        <label>{category === 'ride' ? 'Pickup address' : 'Service address'}</label>
        <div className="find-row premium-find-row">
          <input
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setCoords(null);
              setRoute(null);
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && category === 'ride') findPickup(); }}
            placeholder="Search area, street or building"
          />
          {category === 'ride' && <button type="button" onClick={findPickup} disabled={pickupFinding}>{pickupFinding ? '…' : 'Find'}</button>}
        </div>
        <div className="input-grid-2">
          <input value={pickupPincode} onChange={(e) => setPickupPincode(e.target.value)} placeholder="PIN code" inputMode="numeric" />
          <input value={pickupArea} onChange={(e) => setPickupArea(e.target.value)} placeholder="Locality / area" />
          <input value={pickupStreet} onChange={(e) => setPickupStreet(e.target.value)} placeholder="Road / street" />
          <input value={pickupHouse} onChange={(e) => setPickupHouse(e.target.value)} placeholder="House / building" />
        </div>

        {category === 'ride' && (
          <div className="destination-block">
            <label>Drop location</label>
            <div className="find-row premium-find-row">
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
                placeholder="Where should we drop you?"
              />
              <button type="button" onClick={findDestination} disabled={finding}>{finding ? '…' : 'Find'}</button>
            </div>
            <div className="input-grid-2">
              <input value={dropPincode} onChange={(e) => setDropPincode(e.target.value)} placeholder="PIN code" inputMode="numeric" />
              <input value={dropArea} onChange={(e) => setDropArea(e.target.value)} placeholder="Locality / area" />
              <input value={dropStreet} onChange={(e) => setDropStreet(e.target.value)} placeholder="Road / street" />
              <input value={dropHouse} onChange={(e) => setDropHouse(e.target.value)} placeholder="House / building" />
            </div>
            {route && (
              <div className="ride-summary">
                <span>🛣 {formatDistance(route.distanceKm)} · ~{route.durationMin} min</span>
                <strong>₹{estimatedFare}</strong>
              </div>
            )}
          </div>
        )}

        {category === 'services' && (
          <div className="service-request-field">
            <label>What should we help with?</label>
            <input value={work} onChange={(e) => setWork(e.target.value)} placeholder="e.g. Deep cleaning, fan repair, plumbing…" />
          </div>
        )}

        {error && <p className="auth-error">{error}</p>}

        <button className="cta home-cta" onClick={book} disabled={loading}>
          <span>{loading ? 'Finding the nearest provider…' : `Book my ${category === 'ride' ? 'ride' : 'service'}`}</span>
          {!loading && <span>→</span>}
        </button>
        <p className="booking-note">No hassle · Verified partners · Support when you need it</p>
      </section>

      <section className="why-gofixo">
        <div className="home-section-heading compact">
          <div>
            <span className="section-kicker">WHY GOFIXO</span>
            <h2>Made for everyday life</h2>
          </div>
        </div>
        <div className="trust-cards">
          <div><span>🛡️</span><strong>Verified</strong><small>Trusted partners</small></div>
          <div><span>₹</span><strong>Fair</strong><small>Clear pricing</small></div>
          <div><span>⚡</span><strong>Fast</strong><small>Quick matching</small></div>
        </div>
      </section>
    </div>
  );
}
