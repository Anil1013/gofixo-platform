import { useState } from 'react';
import { apiPost } from '../api';

const RIDE_TYPES = [
  { value: 'bike', label: 'Bike' },
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
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);
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
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setError('Could not get your location. Please allow location access.');
        setLocating(false);
      }
    );
  }

  async function book() {
    setError('');
    if (!coords) {
      setError('Please share your location first.');
      return;
    }
    if (!location) {
      setError('Please describe your pickup location.');
      return;
    }
    setLoading(true);
    try {
      const body = {
        service_type: category,
        provider_type: providerType,
        pickup_location: location,
        drop_or_service_address: category === 'pronto' ? address : undefined,
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

  return (
    <div className="screen">
      <h2>Book a service</h2>

      <div className="tab-switch">
        <button
          className={category === 'ride' ? 'active' : ''}
          onClick={() => { setCategory('ride'); setProviderType('bike'); }}
        >
          🏍 Ride
        </button>
        <button
          className={category === 'pronto' ? 'active' : ''}
          onClick={() => { setCategory('pronto'); setProviderType('general_worker'); }}
        >
          🔧 Pronto (home service)
        </button>
      </div>

      <div className="type-grid">
        {types.map((t) => (
          <button
            key={t.value}
            className={providerType === t.value ? 'type-chip active' : 'type-chip'}
            onClick={() => setProviderType(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label>{category === 'ride' ? 'Pickup location' : 'Service address'}</label>
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Sector 29, Gurgaon" />

      {category === 'pronto' && (
        <>
          <label>What do you need done?</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. Deep cleaning, 2BHK" />
        </>
      )}

      <button type="button" className="secondary" onClick={useMyLocation} disabled={locating}>
        {locating ? 'Getting location...' : coords ? '📍 Location shared' : '📍 Share my location'}
      </button>

      {error && <p className="auth-error">{error}</p>}

      <button className="cta" onClick={book} disabled={loading}>
        {loading ? 'Booking...' : `Book ${category === 'ride' ? 'ride' : 'service'}`}
      </button>
    </div>
  );
}
