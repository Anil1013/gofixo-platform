import { useEffect, useState } from 'react';
import { apiPost, API_BASE, getToken } from '../api';
import MapView from '../components/MapView';
import { navigateToCoords } from '../utils/geo';

const STEPS = [
  { key: 'requested', label: 'Finding driver', icon: '🔍' },
  { key: 'accepted', label: 'On the way', icon: '🚖' },
  { key: 'ongoing', label: 'In progress', icon: '🚦' },
  { key: 'completed', label: 'Completed', icon: '✅' },
];

function stepIndex(status) {
  const i = STEPS.findIndex((s) => s.key === status);
  return i === -1 ? 0 : i;
}

export default function Active({ booking, onRefresh, onDismiss, onDone }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [rated, setRated] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [liveProvider, setLiveProvider] = useState(null);

  // Refresh booking state and the assigned provider's coordinates every 15 seconds
  // while the ride/service is active. The backend only exposes that location to
  // this authenticated customer.
  useEffect(() => {
    if (booking.status === 'completed' || booking.status === 'no_provider') return;
    onRefresh();
    const interval = setInterval(onRefresh, 15 * 1000);
    return () => clearInterval(interval);
  }, [booking.status]);

  // Live provider tracking over WebSocket. HTTP polling remains as a fallback
  // so the map still recovers automatically if the realtime connection drops.
  useEffect(() => {
    setLiveProvider(null);
    if (booking.status === 'completed' || booking.status === 'no_provider') return undefined;

    const token = getToken();
    if (!token || !('WebSocket' in window)) return undefined;

    const wsUrl = API_BASE.replace(/^http/, 'ws') + `/realtime?token=${encodeURIComponent(token)}`;
    let ws;
    let retryTimer;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'subscribe_booking', booking_id: booking.id }));
        };
        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'provider_location' && Number(message.booking_id) === Number(booking.id)) {
              const lat = Number(message.lat);
              const lng = Number(message.lng);
              if (Number.isFinite(lat) && Number.isFinite(lng)) setLiveProvider({ lat, lng });
            }
          } catch {
            // Ignore malformed realtime messages; polling remains available.
          }
        };
        ws.onclose = () => {
          if (!stopped) retryTimer = setTimeout(connect, 3000);
        };
        ws.onerror = () => ws.close();
      } catch {
        retryTimer = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      if (ws) ws.close();
    };
  }, [booking.id, booking.status]);

  async function cancelBooking() {
    setError('');
    try {
      await apiPost(`/bookings/${booking.id}/cancel`, {}, true);
      onDismiss();
      onDone();
    } catch (err) {
      setError(err.message);
      onRefresh();
    }
  }

  async function submitRating() {
    setError('');
    try {
      await apiPost(`/bookings/${booking.id}/rate`, { rating, comment }, true);
      setRated(true);
    } catch (err) {
      setError(err.message);
    }
  }

  function copyPin() {
    navigator.clipboard?.writeText(booking.start_pin);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (booking.status === 'no_provider') {
    return (
      <div className="screen">
        <div className="thanks-card" style={{ background: 'var(--red-bg)', color: 'var(--red)' }}>
          <p>😕 No provider was available nearby right now.</p>
          <small style={{ display: 'block', marginTop: 8, opacity: .8 }}>Taking you back to Home…</small>
        </div>
        <button className="cta" onClick={() => { onDismiss(); onDone(); }}>Back to Home</button>
      </div>
    );
  }

  const current = stepIndex(booking.status);
  const providerLat = liveProvider?.lat ?? Number(booking.provider_lat);
  const providerLng = liveProvider?.lng ?? Number(booking.provider_lng);
  const hasProviderLocation = Number.isFinite(providerLat) && Number.isFinite(providerLng);
  const markers = [{ lat: Number(booking.pickup_lat), lng: Number(booking.pickup_lng), emoji: '📍', color: '#EC4899' }];
  if (hasProviderLocation) {
    markers.push({ lat: providerLat, lng: providerLng, emoji: '🏍', color: '#8B5CF6' });
  }

  return (
    <div className="screen">
      <h2>{booking.service_type === 'ride' ? '🏍 Your ride' : '🔧 Your service'}</h2>

      <div className="stepper">
        {STEPS.map((s, i) => (
          <div key={s.key} className={`step ${i <= current ? 'done' : ''}`}>
            <span className="step-icon">{s.icon}</span>
            <span className="step-label">{s.label}</span>
            {i < STEPS.length - 1 && <span className="step-line" />}
          </div>
        ))}
      </div>

      {booking.status !== 'completed' && <MapView markers={markers} height={180} />}

      <div className="status-card">
        <p className="pickup-line">📍 Pickup: {booking.pickup_location}</p>
        {booking.drop_or_service_address && booking.service_type === 'ride' && (
          <p className="pickup-line">🏁 Drop: {booking.drop_or_service_address}</p>
        )}
        {booking.service_type === 'services' && (
          <>
            <p className="pickup-line">🔧 Service: {String(booking.service_category || 'other').replaceAll('_', ' ')}</p>
            <p className="pickup-line">📍 Service address: {booking.drop_or_service_address || booking.pickup_location}</p>
            {booking.service_description && <p className="pickup-line">📝 {booking.service_description}</p>}
          </>
        )}
        {booking.service_type === 'ride' && booking.fare_amount && (
          <p className="fare-line">Estimated fare <span>₹{Number(booking.fare_amount).toLocaleString('en-IN')}</span></p>
        )}
        {booking.provider_name ? (
          <p className="provider-line">
            {booking.provider_name} · <span className="id-chip">{booking.provider_generated_id}</span>
          </p>
        ) : (
          <p className="provider-line">Looking for the nearest provider...</p>
        )}
      </div>

      {['requested', 'accepted'].includes(booking.status) && (
        <button
          className="secondary"
          onClick={cancelBooking}
          style={{ marginTop: 10 }}
        >
          Cancel booking
        </button>
      )}

      {booking.status === 'accepted' && booking.start_pin && (
        <div className="pin-card" onClick={copyPin}>
          <p className="pin-label">Share this PIN with your provider on arrival</p>
          <p className="pin-value">{booking.start_pin}</p>
          <p className="pin-hint">{copied ? 'Copied ✓' : 'Tap to copy'}</p>
        </div>
      )}

      {booking.status === 'completed' && !rated && (
        <div className="rating-card">
          <p className="fare-line">Fare paid <span>₹{booking.fare_amount}</span></p>
          <p>How was your experience?</p>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={n <= rating ? 'star active' : 'star'} onClick={() => setRating(n)}>★</button>
            ))}
          </div>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment" />
          {error && <p className="auth-error">{error}</p>}
          <button className="cta" onClick={submitRating} disabled={!rating}>Submit rating</button>
          <button className="secondary" onClick={() => { onDismiss(); onDone(); }}>Skip</button>
        </div>
      )}

      {booking.status === 'completed' && rated && (
        <div className="thanks-card"><p>🎉 Thanks for your feedback!</p></div>
      )}

      {booking.status === 'completed' && (
        <button className="cta" onClick={() => { onDismiss(); onDone(); }}>Book another</button>
      )}
    </div>
  );
}
