import { useEffect, useRef, useState } from 'react';
import { apiPost, API_BASE, getToken } from '../api';
import MapView from '../components/MapView';
import ProfilePhoto from '../components/ProfilePhoto';
import { navigateToCoords, getRoute, formatDistance } from '../utils/geo';

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
  const [roadRoute, setRoadRoute] = useState(null);
  const [routeError, setRouteError] = useState('');
  const lastRouteRequest = useRef(null);

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

  // Draw Google Routes road geometry and recalculate when the partner moves or trip phase changes.
  useEffect(() => {
    let cancelled = false;
    async function refreshRoadRoute() {
      const pickup = { lat: Number(booking.pickup_lat), lng: Number(booking.pickup_lng) };
      const drop = { lat: Number(booking.drop_lat), lng: Number(booking.drop_lng) };
      const hasDrop = Number.isFinite(drop.lat) && Number.isFinite(drop.lng)
        && !(drop.lat === 0 && drop.lng === 0);
      // Before a live provider fix arrives, show the booked ride's road route.
      // Once provider GPS is available, route from the moving partner to pickup,
      // then switch to the destination when the trip starts.
      const target = liveProvider && booking.status !== 'ongoing' ? pickup : (hasDrop ? drop : pickup);
      const storedProvider = {
        lat: Number(booking.provider_lat),
        lng: Number(booking.provider_lng),
      };
      const hasStoredProvider = Number.isFinite(storedProvider.lat)
        && Number.isFinite(storedProvider.lng)
        && !(storedProvider.lat === 0 && storedProvider.lng === 0);
      // Match the provider marker: use the last known provider GPS if realtime
      // hasn't delivered a fresh fix yet; otherwise route from the live GPS.
      const origin = liveProvider || (hasStoredProvider && booking.status !== 'ongoing' ? storedProvider : pickup);
      if (![origin.lat, origin.lng, target.lat, target.lng].every(Number.isFinite)
        || (origin.lat === 0 && origin.lng === 0) || (target.lat === 0 && target.lng === 0)) {
        setRoadRoute(null);
        return;
      }
      const previous = lastRouteRequest.current;
      if (previous && previous.target.lat === target.lat && previous.target.lng === target.lng) {
        const rad = (value) => value * Math.PI / 180;
        const dLat = rad(origin.lat - previous.origin.lat);
        const dLng = rad(origin.lng - previous.origin.lng);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(previous.origin.lat)) * Math.cos(rad(origin.lat)) * Math.sin(dLng / 2) ** 2;
        const movedMeters = 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
        if (movedMeters < 100) return;
      }
      try {
        const result = await getRoute(origin, target);
        if (!cancelled) {
          lastRouteRequest.current = { origin, target };
          setRoadRoute(result);
          setRouteError('');
        }
      } catch {
        if (!cancelled) { setRoadRoute(null); setRouteError('Road route is temporarily unavailable.'); }
      }
    }
    refreshRoadRoute();
    return () => { cancelled = true; };
  }, [booking.id, booking.status, booking.pickup_lat, booking.pickup_lng, booking.drop_lat, booking.drop_lng, liveProvider?.lat, liveProvider?.lng]);

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

      {booking.status !== 'completed' && (
        <>
          <MapView markers={markers} line={roadRoute?.line || null} height={220} />
          {roadRoute && (
            <div className="status-card" style={{ marginTop: 8 }}>
              <p className="fare-line">Road route <span>{formatDistance(roadRoute.distanceKm)} · ~{roadRoute.durationMin} min</span></p>
              {roadRoute.steps?.length > 0 && (
                <ol className="route-directions">
                  {roadRoute.steps.slice(0, 5).map((step, index) => (
                    <li key={`${index}-${step.instruction}`}>
                      <span>{step.instruction}</span>
                      {step.distanceMeters > 0 && <small>{formatDistance(step.distanceMeters / 1000)}</small>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          {routeError && <p className="auth-error">{routeError}</p>}
        </>
      )}

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
        {booking.provider_name && booking.provider_id ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <ProfilePhoto role="provider" userId={booking.provider_id} size="compact" editable={false} />
            <p className="provider-line">
              {booking.provider_name} · <span className="id-chip">{booking.provider_generated_id}</span>
            </p>
          </div>
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
