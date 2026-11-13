import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, getRole, getToken, getUser } from '../api';
import ProfilePhoto from '../components/ProfilePhoto';
import MapView from '../components/MapView';
import { reverseGeocodeDetails, reverseGeocode, searchAddress, searchAddressSuggestions, getPlaceDetails, getRoute, formatDistance } from '../utils/geo';

const RIDE_TYPES = [
  { value: 'bike', label: 'Bike' },
  { value: 'auto', label: 'Auto' },
  { value: 'car', label: 'Car' },
];

const FARE_RULES = {
  // Base fare remains separate; distance is charged progressively by slab.
  bike: {
    base: 30,
    minimum: 30,
    slabs: [
      { upto: 10, rate: 6 },
      { upto: 20, rate: 5.5 },
      { upto: 30, rate: 5 },
      { upto: 50, rate: 4.5 },
      { upto: Infinity, rate: 4.5 },
    ],
  },
  auto: {
    base: 40,
    minimum: 40,
    slabs: [
      { upto: 10, rate: 7.5 },
      { upto: 20, rate: 6.5 },
      { upto: 30, rate: 6 },
      { upto: 50, rate: 5.5 },
      { upto: Infinity, rate: 5.5 },
    ],
  },
  car: {
    base: 60,
    minimum: 60,
    slabs: [
      { upto: 10, rate: 9.5 },
      { upto: 20, rate: 9 },
      { upto: 30, rate: 8 },
      { upto: 50, rate: 6.5 },
      { upto: 100, rate: 5 },
      { upto: Infinity, rate: 2.5 },
    ],
  },
};

function calculateFare(providerType, distanceKm) {
  const rule = FARE_RULES[providerType] || FARE_RULES.bike;
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km <= 0) return rule.minimum;

  let remainingKm = km;
  let previousLimit = 0;
  let distanceFare = 0;

  for (const slab of rule.slabs) {
    const slabKm = Math.max(0, Math.min(remainingKm, slab.upto - previousLimit));
    if (slabKm > 0) {
      distanceFare += slabKm * slab.rate;
      remainingKm -= slabKm;
    }
    previousLimit = slab.upto;
    if (remainingKm <= 0) break;
  }

  return Math.max(rule.minimum, Math.round(rule.base + distanceFare));
}

const RIDE_VISUALS = {
  bike: { image: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=900&q=88', title: 'Bike', sub: 'Fast & affordable', tone: 'orange' },
  auto: { image: 'https://images.unsplash.com/photo-1703142488992-72018a83fd8a?auto=format&fit=crop&w=900&q=82', title: 'Auto', sub: 'Comfortable rides', tone: 'green' },
  car: { image: 'https://images.unsplash.com/photo-1503736334956-4c8f8e92946d?auto=format&fit=crop&w=900&q=88', title: 'Car', sub: 'Premium & safe', tone: 'blue' },
};

const HOME_SERVICE_CARDS = [
  { label: 'Electrician', category: 'electrician', type: 'skilled_worker', image: 'https://eletricistagravatai.com.br/images/eletricista-24h-perto-de-voce-em-gravatai-rs.jpeg' },
  { label: 'Plumber', category: 'plumber', type: 'skilled_worker', image: 'https://handymanpalmbayfl.com/images/plumbing_service_2.webp' },
  { label: 'AC Service', category: 'ac_service', type: 'skilled_worker', image: 'https://imagedelivery.net/xaKlCos5cTg_1RWzIu_h-A/63023f11-6fa4-41a7-ca68-748ee14fc600/public' },
  { label: 'Cleaning', category: 'cleaning', type: 'general_worker', image: 'https://www.trueprocleaners.com/imgs/oc-house-cleaning-european-01.webp' },
  { label: 'Carpenter', category: 'carpenter', type: 'skilled_worker', image: 'https://images.unsplash.com/photo-1756736668332-e921516c1305?auto=format&fit=crop&w=700&q=82' },
  { label: 'Home Repair', category: 'other', type: 'skilled_worker', image: 'https://manitasenbarcelona.com/images/sobre-nosotros-manitas-barcelona.jpg' },
  { label: 'Appliance Repair', category: 'appliance_repair', type: 'skilled_worker', image: 'https://www.trueprocleaners.com/imgs/oc-house-cleaning-european-01.webp' },
  { label: 'More', category: 'other', type: 'general_worker', image: 'https://allhomerepairs247.com/images/woman-ipad-red.webp' },
];

const LOCATION_PROMPTED_KEY = 'gofixo_location_prompted';

async function buildRoute(from, to) {
  if (!from || !to || !Number.isFinite(Number(from.lat)) || !Number.isFinite(Number(from.lng))
    || !Number.isFinite(Number(to.lat)) || !Number.isFinite(Number(to.lng))) {
    throw new Error('Please select valid pickup and destination locations.');
  }

  const routed = await getRoute(from, to);
  if (!routed || !Number.isFinite(routed.distanceKm) || routed.distanceKm <= 0 || !Array.isArray(routed.line) || routed.line.length < 2) {
    throw new Error('Google Maps could not calculate a drivable route. Please check the map API setup and try again.');
  }
  return routed;
}

export default function Home({ onBooked, initialCategory = 'ride' }) {
  const [category, setCategory] = useState(initialCategory); // ride | services
  const [showBooking, setShowBooking] = useState(false);
  const [providerType, setProviderType] = useState('bike');
  const [location, setLocation] = useState('');
  const [work, setWork] = useState('');
  const [serviceCategory, setServiceCategory] = useState('');
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [serviceCatalogLoaded, setServiceCatalogLoaded] = useState(false);
  const [serviceQuantity, setServiceQuantity] = useState(1);
  const [serviceVariantKey, setServiceVariantKey] = useState('');
  const [serviceAddOns, setServiceAddOns] = useState([]);
  const [serviceQuote, setServiceQuote] = useState(null);
  const [serviceQuoteError, setServiceQuoteError] = useState('');
  const [serviceQuoteLoading, setServiceQuoteLoading] = useState(false);
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
    if (initialCategory === 'services') {
      setProviderType('general_worker');
      setServiceCategory((current) => current || 'other');
    }
  }, [initialCategory]);

  useEffect(() => {
    let active = true;
    apiGet('/catalog/services').then((items) => {
      if (!active || !Array.isArray(items)) return;
      const mapped = items.map((item) => ({
        label: item.label,
        category: item.key,
        type: item.providerType,
        image: item.imageUrl,
        baseFare: Number(item.baseFare || 0),
        pricingRule: item.pricingRule || item.metadata?.pricingRule || null,
        taskOptions: Array.isArray(item.metadata?.taskOptions) ? item.metadata.taskOptions : [],
      }));
      setServiceCatalog(mapped);
      setServiceCatalogLoaded(true);
      if (mapped.length) {
        setServiceCategory((current) => (
          mapped.find((item) => item.category === current)
          || mapped.find((item) => item.category === 'other')
          || mapped[0]
        ).category);
      }
    }).catch(() => { if (active) setServiceCatalogLoaded(false); });
    return () => { active = false; };
  }, []);

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

  const homeServiceCards = serviceCatalogLoaded ? serviceCatalog : HOME_SERVICE_CARDS;
  const selectedService = homeServiceCards.find((item) => item.category === serviceCategory) || null;
  const pricingRule = selectedService?.pricingRule || null;

  useEffect(() => {
    if (category !== 'services' || !serviceCategory || !selectedService || !getToken() || getRole() !== 'customer') {
      setServiceQuote(null);
      setServiceQuoteError('');
      setServiceQuoteLoading(false);
      return undefined;
    }
    let active = true;
    const selection = {
      quantity: serviceQuantity,
      addOns: serviceAddOns,
      ...(serviceVariantKey ? { variantKey: serviceVariantKey } : {}),
    };
    const timer = setTimeout(async () => {
      setServiceQuoteLoading(true);
      setServiceQuoteError('');
      try {
        const quote = await apiPost(`/catalog/${encodeURIComponent(serviceCategory)}/quote`, { selection }, true);
        if (active) setServiceQuote(quote);
      } catch (err) {
        if (active) { setServiceQuote(null); setServiceQuoteError(err.message || 'Service estimate is unavailable.'); }
      } finally {
        if (active) setServiceQuoteLoading(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [category, serviceCategory, serviceCatalog, serviceCatalogLoaded, serviceQuantity, serviceVariantKey, serviceAddOns.join('|')]);

  useEffect(() => {
    if (category !== 'services' || !selectedService) return;
    if (selectedService.type && providerType !== selectedService.type) setProviderType(selectedService.type);
    const rule = selectedService.pricingRule;
    const minimum = Number(rule?.minimumQuantity || 1);
    const maximum = Number(rule?.maximumQuantity || 1000);
    setServiceQuantity((current) => current < minimum || current > maximum ? minimum : current);
    if (Array.isArray(rule?.variants) && rule.variants.length) {
      if (!rule.variants.some((variant) => variant.key === serviceVariantKey)) setServiceVariantKey(rule.variants[0].key);
    } else {
      setServiceVariantKey('');
    }
    setServiceAddOns([]);
  }, [category, serviceCategory, serviceCatalog, providerType]);

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

    // Booking must always be created from an authenticated customer session.
    // Keep this guard here as a second layer in addition to App.jsx routing.
    if (!getToken() || getRole() !== 'customer' || !getUser()) {
      setError('Please log in first to request a ride or home & lifestyle service.');
      return;
    }
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

      const pricingSelection = category === 'services' ? {
        quantity: serviceQuantity,
        addOns: serviceAddOns,
        ...(serviceVariantKey ? { variantKey: serviceVariantKey } : {}),
      } : undefined;
      if (category === 'services') {
        const quote = await apiPost(`/catalog/${encodeURIComponent(serviceCategory || 'other')}/quote`, { selection: pricingSelection || {} }, true);
        setServiceQuote(quote);
        setServiceQuoteError('');
      }
      const body = {
        service_type: category,
        provider_type: providerType,
        pickup_location: [location, pickupHouse, pickupStreet, pickupArea, pickupPincode].filter(Boolean).join(', '),
        drop_or_service_address: category === 'services' ? [location, pickupHouse, pickupStreet, pickupArea, pickupPincode].filter(Boolean).join(', ') : [destination, dropHouse, dropStreet, dropArea, dropPincode].filter(Boolean).join(', '),
        service_category: category === 'services' ? (serviceCategory || 'other') : undefined,
        service_description: category === 'services' ? work.trim() : undefined,
        pricing_selection: pricingSelection,
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

  const estimatedFare = category === 'ride' && route ? calculateFare(providerType, route.distanceKm) : null;
  const currentUser = getUser() || {};
  const previewServices = homeServiceCards.slice(0, 4);

  const markers = [];
  if (coords) markers.push({ lat: coords.lat, lng: coords.lng, emoji: '📍', color: '#EC4899' });
  if (category === 'ride' && destCoords) markers.push({ lat: destCoords.lat, lng: destCoords.lng, emoji: '🏁', color: '#14B8A6' });

  return (
    <div className="screen home-screen customer-reference-screen">
      <header className="customer-app-header">
        <div className="customer-logo">
          <span className="customer-logo-pin" />
          <div><strong>Gofi<span>xo</span></strong><small>Ride · Delivery · Home & Lifestyle Services</small></div>
        </div>
        <div className="customer-header-actions">
          <button type="button" className="customer-notification" aria-label="Notifications">●<i /></button>
          <div className="customer-avatar-mini">
            <ProfilePhoto role="customer" userId={currentUser.id} size="compact" />
          </div>
        </div>
      </header>

      <section className="customer-reference-hero">
        <div className="customer-hero-copy">
          <h1>Your City</h1>
          <h1 className="orange">Your Services</h1>
          <p>Rides, Home & Lifestyle Services<br />and more — All in One App</p>
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
                key={item.placeId || item.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={async () => {
                  setFinding(true);
                  setError('');
                  try {
                    const found = await getPlaceDetails(item.placeId);
                    if (!Number.isFinite(found.lat) || !Number.isFinite(found.lng)) {
                      throw new Error('Selected destination has no valid coordinates.');
                    }
                    const point = { lat: found.lat, lng: found.lng };
                    setDestination(found.label || item.label);
                    destinationResolvedRef.current = found.label || item.label;
                    setDestCoords(point);
                    setDestinationSuggestions([]);
                    setRoute(coords ? await buildRoute(coords, point) : null);
                  } catch (err) {
                    setError(err?.message || 'Could not load that destination. Please try again.');
                    setDestinationSuggestions([]);
                  } finally {
                    setFinding(false);
                  }
                }}
              >
                <strong>{item.mainText || item.label}</strong>
                {item.secondaryText && <small>{item.secondaryText}</small>}
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
          <h2>Home & Lifestyle Services</h2>
          <button type="button" onClick={() => { setCategory('services'); setProviderType('general_worker'); setServiceCategory('other'); setWork(''); setShowBooking(true); }}>See all →</button>
        </div>
        <div className="reference-service-cards">
          {previewServices.length === 0 ? <p className="booking-note">No home services are currently available.</p> : previewServices.map((item) => (
            <button type="button" key={item.label} onClick={() => {
              setCategory('services');
              setProviderType(item.type);
              setServiceCategory(item.category);
              setProviderType(item.type);
              setServiceQuantity(Number(item.pricingRule?.minimumQuantity || 1));
              setServiceVariantKey(item.pricingRule?.variants?.[0]?.key || '');
              setServiceAddOns([]);
              setServiceQuote(null);
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
          <span>GOFIXO HOME & LIFESTYLE SERVICES</span>
          <h2>Trusted Professionals<br />for Your Home</h2>
          <p><b>✓</b> Verified &nbsp; <b>✓</b> Affordable &nbsp; <b>✓</b> On-Time</p>
          <button type="button" onClick={() => { setCategory('services'); setProviderType('general_worker'); setServiceCategory('other'); setWork(''); setShowBooking(true); }}>Book Now →</button>
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
              {homeServiceCards.length === 0 ? <p className="booking-note">No home services are currently available. Please check again later.</p> : <div className="service-choice-grid">
                {homeServiceCards.map((item) => (
                  <button
                    type="button"
                    key={item.label}
                    className={`service-choice-card ${serviceCategory === item.category && !!work.trim() ? 'selected' : ''}`}
                    aria-pressed={serviceCategory === item.category && !!work.trim()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      setProviderType(item.type);
                      setServiceCategory(item.category);
                      setServiceQuantity(Number(item.pricingRule?.minimumQuantity || 1));
                      setServiceVariantKey(item.pricingRule?.variants?.[0]?.key || '');
                      setServiceAddOns([]);
                      setServiceQuote(null);
                      setWork(item.label);
                      setError('');
                    }}
                  >
                    <img src={item.image} alt="" />
                    <span>{item.label}</span>
                    {work === item.label && <b>✓</b>}
                  </button>
                ))}
              </div>}
              {selectedService?.taskOptions?.length > 0 && (
                <div className="service-task-options">
                  <small>Suggested tasks</small>
                  <div className="service-choice-grid">
                    {selectedService.taskOptions.map((task) => (
                      <button type="button" key={task} className={work === task ? 'selected' : ''} onClick={() => setWork(task)}>{task}</button>
                    ))}
                  </div>
                </div>
              )}
              {pricingRule?.pricingMode !== 'inspection_quote' && pricingRule?.variants?.length > 0 && (
                <label className="service-pricing-field">Choose package / size
                  <select value={serviceVariantKey} onChange={(event) => setServiceVariantKey(event.target.value)}>
                    {pricingRule.variants.map((variant) => <option key={variant.key} value={variant.key}>{variant.label || variant.key} · ₹{Number(variant.price || 0).toLocaleString('en-IN')}</option>)}
                  </select>
                </label>
              )}
              {pricingRule && pricingRule.pricingMode !== 'fixed' && pricingRule.pricingMode !== 'inspection_quote' && !pricingRule.variants?.length && (
                <label className="service-pricing-field">{pricingRule.unitLabel || 'Quantity'}
                  <input type="number" min={pricingRule.minimumQuantity ?? 1} max={pricingRule.maximumQuantity ?? 1000} step={pricingRule.quantityStep ?? 1} value={serviceQuantity} onChange={(event) => setServiceQuantity(Number(event.target.value))} />
                </label>
              )}
              {pricingRule?.pricingMode !== 'inspection_quote' && pricingRule?.addOns?.length > 0 && (
                <div className="service-pricing-field"><strong>Optional add-ons</strong>
                  {pricingRule.addOns.map((addon) => (
                    <label key={addon.key} className="service-addon-option"><input type="checkbox" checked={serviceAddOns.includes(addon.key)} onChange={(event) => setServiceAddOns((current) => event.target.checked ? [...current, addon.key] : current.filter((key) => key !== addon.key))} /> {addon.label || addon.key} · ₹{Number(addon.price || 0).toLocaleString('en-IN')}</label>
                  ))}
                </div>
              )}
              {serviceQuoteLoading && <p className="booking-note">Calculating your service estimate…</p>}
              {serviceQuoteError && <p className="auth-error">{serviceQuoteError}</p>}
              {serviceQuote && (
                <div className="ride-summary">
                  <span>{serviceQuote.requiresQuote ? 'Inspection visit fee' : 'Estimated service amount'}{serviceQuote.requiresQuote ? ' · final repair quote after inspection' : ''}</span>
                  <strong>₹{Number(serviceQuote.total || 0).toLocaleString('en-IN')}</strong>
                </div>
              )}
              {homeServiceCards.some((item) => item.category === 'other') && <input
                className="service-custom-input"
                value={homeServiceCards.some((item) => item.label === work) ? '' : work}
                onChange={(e) => {
                  setWork(e.target.value);
                  setServiceCategory(e.target.value.trim() ? 'other' : '');
                  setProviderType(homeServiceCards.find((item) => item.category === 'other')?.type || 'general_worker');
                  setServiceQuantity(1);
                  setServiceVariantKey('');
                  setServiceAddOns([]);
                  setServiceQuote(null);
                  setError('');
                }}
                placeholder="Or describe another service…"
              />}
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
                  <span>🛣 {formatDistance(route.distanceKm)} · Google Maps ETA ~{route.durationMin} min</span>
                  <strong>₹{estimatedFare}</strong>
                </div>
              )}
              {route?.steps?.length > 0 && (
                <div className="route-directions" aria-label="Google Maps route directions">
                  <h3>Route directions</h3>
                  <ol>
                    {route.steps.map((step, index) => (
                      <li key={index}>
                        <span>{step.instruction}</span>
                        {step.distanceMeters > 0 && <small>{formatDistance(step.distanceMeters / 1000)}</small>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button className="cta home-cta reference-book-cta" onClick={book} disabled={loading || (category === 'services' && !work.trim())}>
            <span>{loading ? 'Finding the nearest provider…' : category === 'ride' ? 'Book a Ride' : 'Book Home & Lifestyle Service'}</span>
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
