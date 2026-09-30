import { useEffect, useRef, useState } from 'react';
import { apiPost, getUser } from '../api';
import ProfilePhoto from '../components/ProfilePhoto';
import MapView from '../components/MapView';
import { reverseGeocodeDetails, reverseGeocode, searchAddress, searchAddressSuggestions, getRoute, formatDistance } from '../utils/geo';

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
  bike: { image: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=900&q=88', title: 'Bike', sub: 'Fast & affordable', tone: 'orange' },
  auto: { image: 'https://images.unsplash.com/photo-1703142488992-72018a83fd8a?auto=format&fit=crop&w=900&q=82', title: 'Auto', sub: 'Comfortable rides', tone: 'green' },
  car: { image: 'https://images.unsplash.com/photo-1503736334956-4c8f8e92946d?auto=format&fit=crop&w=900&q=88', title: 'Car', sub: 'Premium & safe', tone: 'blue' },
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

function calculateStraightLineKm(from, to) {
  if (!from || !to) return 0;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

async function buildRoute(from, to) {
  if (!from || !to || !Number.isFinite(Number(from.lat)) || !Number.isFinite(Number(from.lng))
    || !Number.isFinite(Number(to.lat)) || !Number.isFinite(Number(to.lng))) {
    return null;
  }

  let routed = null;
  try {
    routed = await getRoute(from, to);
  } catch {
    routed = null;
  }
  if (routed && Number.isFinite(routed.distanceKm) && routed.distanceKm > 0) return routed;
  const distanceKm = calculateStraightLineKm(from, to);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  return {
    distanceKm: Math.max(distanceKm, 0.1),
    durationMin: Math.max(1, Math.round(distanceKm * 3)),
    line: null,
    fallback: true,
  };
}

export default function Home({ onBooked, initialCategory = 'ride' }) {
  const [category, setCategory] = useState(initialCategory); // ride | services
  const [showBooking, setShowBooking] = useState(false);
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
  const [destinationSuggestions, setDestinationSuggestions] = useState([]);
  const [destCoords, setDestCoords] = useState(null);
  const [route, setRoute] = useState(null);
  const [pickupFinding, setPickupFinding] = useState(false);
  const [locating, setLocating] = useState(false);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCategory(initialCategory);
  }, [initialCategory]);

  useEffect(() => {
    const query = destination.trim();
    if (query.length < 3) {
      setDestinationSuggestions([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      const suggestions = await searchAddressSuggestions(query, coords);
      setDestinationSuggestions(suggestions);
    }, 350);
    return () => clearTimeout(timer);
  }, [destination, coords]);

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
      setRoute(await buildRoute(here, destCoords));
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
    if (destCoords) setRoute(await buildRoute(pickup, destCoords));
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
    setRoute(coords ? await buildRoute(coords, { lat: found.lat, lng: found.lng }) : null);
    setFinding(false);
  }

  async function book() {
    setError('');
    if (category === 'services' && !work.trim()) {
      setError('Please select the service you need.');
      return;
    }
    if (!coords) {
      setError('Please allow location access so we can use your current pickup location.');
      return;
    }
    if (!location) {
      setError('Please confirm your pickup location.');
      return;
    }
    if (pickupPincode && !/^\d{6}$/.test(String(pickupPincode))) {
      setError('Pickup PIN code must be 6 digits if provided.');
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
        resolvedRoute = await buildRoute(coords, found);
        setDestination(found.label);
        destinationResolvedRef.current = query;
        setDestCoords(resolvedDestination);
        setRoute(resolvedRoute);
      }

      if (category === 'ride' && (!resolvedDestination || !resolvedRoute)) {
        setError('Please enter a valid drop location so we can calculate the fare.');
        return;
      }
      if (category === 'ride' && dropPincode && !/^\d{6}$/.test(String(dropPincode))) {
        setError('Drop PIN code must be 6 digits if provided.');
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
      setError(err?.message || 'Ride booking failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const types = category === 'ride' ? RIDE_TYPES : HOME_SERVICE_TYPES;
  const estimatedFare = category === 'ride' && route ? calculateFare(providerType, route.distanceKm) : null;
  const currentUser = getUser() || {};
  const previewServices = HOME_SERVICE_CARDS.slice(0, 4);

  const markers = [];
  if (coords) markers.push({ lat: coords.lat, lng: coords.lng, emoji: '📍', color: '#EC4899' });
  if (category === 'ride' && destCoords) markers.push({ lat: destCoords.lat, lng: destCoords.lng, emoji: '🏁', color: '#14B8A6' });

  return (
    <div className="screen home-screen customer-reference-screen">
      <header className="customer-app-header">
        <div className="customer-logo">
          <span className="customer-logo-pin" />
          <div><strong>Gofi<span>xo</span></strong><small>Ride · Delivery · Home Services</small></div>
        </div>
        <div className="customer-header-actions">
          <button type="button" className="customer-notification" aria-label="Notifications">●<i /></button>
          <div className="customer-avatar-mini">
            <ProfilePhoto role="customer" userId={currentUser.id} size="compact" fallbackImage="https://images.unsplash.com/photo-1669555354650-02227bc6c811?auto=format&fit=crop&w=240&q=80" />
          </div>
        </div>
      </header>

      <section className="customer-reference-hero">
        <div className="customer-hero-copy">
          <h1>Your City</h1>
          <h1 className="orange">Your Services</h1>
          <p>Rides, Home Services<br />and more — All in One App</p>
        </div>
        <div className="reference-vehicle-strip">
          {RIDE_TYPES.map((t) => {
            const visual = RIDE_VISUALS[t.value];
            return (
              <button type="button" key={t.value} aria-pressed={providerType === t.value} className={providerType === t.value ? 'selected' : ''} onClick={() => {
                setCategory('ride');
                setProviderType(t.value);
                setShowBooking(true);
              }}>
                <img src={visual.image} alt={visual.title} />
                <b>{visual.title}</b>
              </button>
            );
          })}
        </div>
      </section>

      <div className="reference-location-search reference-destination-search">
        <span className="location-pin-mark">⌖</span>
        <input
          value={destination}
          onFocus={() => {
            setCategory('ride');
            setShowBooking(true);
          }}
          onChange={async (e) => {
            const value = e.target.value;
            setCategory('ride');
            setShowBooking(true);
            setDestination(value);
            destinationResolvedRef.current = '';
            setDestCoords(null);
            setRoute(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              findDestination();
              setDestinationSuggestions([]);
            }
          }}
          placeholder="Where are you going?"
          aria-label="Where are you going?"
        />
        {finding ? <span className="destination-search-status">…</span> : <i>⌕</i>}
        {destinationSuggestions.length > 0 && (
          <div className="destination-suggestions">
            {destinationSuggestions.map((item) => (
              <button
                type="button"
                key={item.lat + ':' + item.lng + ':' + item.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setDestination(item.label);
                  destinationResolvedRef.current = item.label;
                  setDestCoords({ lat: item.lat, lng: item.lng });
                  setDestinationSuggestions([]);
                  if (coords) {
                    buildRoute(coords, { lat: item.lat, lng: item.lng })
                      .then(setRoute)
                      .catch(() => setRoute(null));
                  }
                }}
              >
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="reference-home-section">
        <div className="reference-section-title">
          <h2>Book a Ride</h2>
          <button type="button" onClick={() => { setCategory('ride'); setShowBooking(true); }}>See all →</button>
        </div>
        <div className="reference-ride-cards">
          {RIDE_TYPES.map((t) => {
            const visual = RIDE_VISUALS[t.value];
            return (
              <button type="button" key={t.value} aria-pressed={providerType === t.value} className={`reference-ride-tile ${providerType === t.value ? 'selected' : ''}`} onClick={() => {
                setCategory('ride');
                setProviderType(t.value);
                setShowBooking(true);
              }}>
                <div><img src={visual.image} alt="" /></div>
                <strong>{visual.title}</strong>
                <small>{visual.sub}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="reference-home-section services-reference-section">
        <div className="reference-section-title">
          <h2>Home Services</h2>
          <button type="button" onClick={() => { setCategory('services'); setShowBooking(true); }}>See all →</button>
        </div>
        <div className="reference-service-cards">
          {previewServices.map((item) => (
            <button type="button" key={item.label} onClick={() => {
              setCategory('services');
              setProviderType(item.type);
              setWork(item.label);
              setShowBooking(true);
            }}>
              <img src={item.image} alt="" loading="lazy" />
              <strong>{item.label}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="trusted-professionals-banner">
        <div>
          <span>GOFIXO HOME SERVICES</span>
          <h2>Trusted Professionals<br />for Your Home</h2>
          <p><b>✓</b> Verified &nbsp; <b>✓</b> Affordable &nbsp; <b>✓</b> On-Time</p>
          <button type="button" onClick={() => { setCategory('services'); setShowBooking(true); }}>Book Now →</button>
        </div>
        <img src="https://images.unsplash.com/photo-1756736668332-e921516c1305?auto=format&fit=crop&w=700&q=82" alt="" />
      </section>

      {showBooking && (
        <section className="reference-booking-panel">
          <div className="reference-booking-head">
            <div>
              <span>{category === 'ride' ? 'BOOK A RIDE' : 'BOOK HOME SERVICE'}</span>
              <h2>{category === 'ride' ? 'Where are you going?' : 'Tell us what you need'}</h2>
            </div>
            <button type="button" onClick={() => setShowBooking(false)} aria-label="Close booking">×</button>
          </div>

          {category === 'ride' && (
            <div className="ride-choice-field">
              <label>Select your ride</label>
              <div className="ride-choice-grid">
                {RIDE_TYPES.map((t) => {
                  const visual = RIDE_VISUALS[t.value];
                  const selected = providerType === t.value;
                  return (
                    <button
                      type="button"
                      key={t.value}
                      className={`ride-choice-card ${selected ? 'selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => {
                        setCategory('ride');
                        setProviderType(t.value);
                        setError('');
                      }}
                    >
                      <img src={visual.image} alt={visual.title} />
                      <span className="ride-choice-copy">
                        <strong>{visual.title}</strong>
                        <small>{visual.sub}</small>
                      </span>
                      <span className="ride-choice-check">{selected ? '✓ Selected' : 'Select'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {category === 'services' && (
            <div className="service-request-field service-request-field-top">
              <label>Select the service you need</label>
              <div className="service-choice-grid">
                {HOME_SERVICE_CARDS.map((item) => (
                  <button
                    type="button"
                    key={item.label}
                    className={`service-choice-card ${work === item.label ? 'selected' : ''}`}
                    aria-pressed={work === item.label}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      setProviderType(item.type);
                      setWork(item.label);
                      setError('');
                    }}
                  >
                    <img src={item.image} alt="" />
                    <span>{item.label}</span>
                    {work === item.label && <b>✓</b>}
                  </button>
                ))}
              </div>
              <input
                className="service-custom-input"
                value={HOME_SERVICE_CARDS.some((item) => item.label === work) ? '' : work}
                onChange={(e) => {
                  setWork(e.target.value);
                  setProviderType(e.target.value.trim() ? 'skilled_worker' : 'general_worker');
                  setError('');
                }}
                placeholder="Or describe another service…"
              />
            </div>
          )}

          <button type="button" className="location-card reference-location-card" onClick={useMyLocation} disabled={locating}>
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
                  onChange={async (e) => {
                    const value = e.target.value;
                    setDestination(value);
                    destinationResolvedRef.current = '';
                    setDestCoords(null);
                    setRoute(null);
                  }}
                  onBlur={() => setTimeout(() => {
                    setDestinationSuggestions([]);
                    findDestination();
                  }, 120)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setDestinationSuggestions([]);
                      findDestination();
                    }
                  }}
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

          {error && <p className="auth-error">{error}</p>}

          <button className="cta home-cta reference-book-cta" onClick={book} disabled={loading || (category === 'services' && !work.trim())}>
            <span>{loading ? 'Finding the nearest provider…' : category === 'ride' ? 'Book a Ride' : 'Book Home Service'}</span>
            {!loading && <span>→</span>}
          </button>
          <p className="booking-note">No hassle · Verified partners · Support when you need it</p>
        </section>
      )}

      <section className="reference-why">
        <div className="reference-section-title"><h2>Why Gofixo?</h2></div>
        <div className="reference-why-grid">
          <div><span>✓</span><strong>Verified</strong><small>Trusted partners</small></div>
          <div><span>₹</span><strong>Fair pricing</strong><small>Clear estimates</small></div>
          <div><span>⚡</span><strong>Fast</strong><small>Quick matching</small></div>
        </div>
      </section>
    </div>
  );

}
