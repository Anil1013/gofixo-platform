import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../api';
import MapView from '../components/MapView';
import { getRoute } from '../utils/geo';
import { startBuzzer, stopBuzzer } from '../utils/buzzer';

const TYPE_ICON = { bike: '🏍', auto: '🛺', car: '🚗', general_worker: '🧹', skilled_worker: '🔧' };
const OFFER_SECONDS = 30;

export default function ProviderHome() {
  const [profile, setProfile] = useState(null);
  const [activeBooking, setActiveBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState('');
  const [fareAmount, setFareAmount] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [pickupRoute, setPickupRoute] = useState(null);

  const buzzingRef = useRef(false);
  const buzzedBookingRef = useRef(null);
  const pushSetupRef = useRef(false);

  async function loadAll() {
    try {
      const [me, bookings] = await Promise.all([
        apiGet('/providers/me', true),
        apiGet('/bookings/mine/provider', true),
      ]);
      setProfile(me);
      const active = bookings.find((b) => ['requested', 'accepted', 'ongoing'].includes(b.status));
      setActiveBooking(active || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeBooking?.status === 'ongoing' && activeBooking.fare_amount) {
      setFareAmount(String(Number(activeBooking.fare_amount)));
    }
    if (!activeBooking || activeBooking.status !== 'accepted') {
      setPickupRoute(null);
      return;
    }
    const from = profile?.current_lat && profile?.current_lng
      ? { lat: Number(profile.current_lat), lng: Number(profile.current_lng) }
      : null;
    const to = activeBooking.pickup_lat && activeBooking.pickup_lng
      ? { lat: Number(activeBooking.pickup_lat), lng: Number(activeBooking.pickup_lng) }
      : null;
    if (!from || !to) {
      setPickupRoute(null);
      return;
    }
    getRoute(from, to).then(setPickupRoute).catch(() => setPickupRoute(null));
  }, [activeBooking?.id, activeBooking?.status, profile?.current_lat, profile?.current_lng]);

  // Polling continues for live status, but the same requested booking must
  // never restart the buzzer every 4 seconds. Buzz only for a newly detected ride.
  useEffect(() => {
    const isRequested = activeBooking && activeBooking.status === 'requested';
    if (isRequested && buzzedBookingRef.current !== activeBooking.id) {
      stopBuzzer();
      startBuzzer(6000);
      buzzedBookingRef.current = activeBooking.id;
      buzzingRef.current = true;
    }
    if (!isRequested) {
      stopBuzzer();
      buzzingRef.current = false;
      if (!activeBooking) buzzedBookingRef.current = null;
    }
    if (isRequested && activeBooking.offered_at) {
      const tick = () => {
        const elapsed = (Date.now() - new Date(activeBooking.offered_at).getTime()) / 1000;
        setSecondsLeft(Math.max(0, Math.ceil(OFFER_SECONDS - elapsed)));
      };
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    }
    return undefined;
  }, [activeBooking?.id, activeBooking?.status, activeBooking?.offered_at]);

  useEffect(() => () => stopBuzzer(), []); // stop on unmount

  async function setupBackgroundNotifications() {
    if (pushSetupRef.current || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission === 'denied') return;

    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') return;

      const registration = await navigator.serviceWorker.register('/sw.js');
      const keyResponse = await apiGet('/providers/push/public-key', true);
      if (!keyResponse.public_key) return;

      const base64ToUint8 = (value) => {
        const padding = '='.repeat((4 - (value.length % 4)) % 4);
        const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
        return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      };

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8(keyResponse.public_key),
        });
      }

      await apiPost('/providers/push-subscription', subscription.toJSON(), true);
      pushSetupRef.current = true;
    } catch {
      // Foreground buzzer remains available if background push is unavailable.
    }
  }

  async function updateCurrentLocation(refreshProfile = false) {
    if (!navigator.geolocation) {
      throw new Error('Location not available on this device.');
    }

    await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            await apiPatch(`/providers/${profile.id}/location`, {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            }, true);
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        () => reject(new Error('Could not get your location.')),
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
      );
    });

    if (refreshProfile) await loadAll();
  }

  async function toggleAvailability() {
    setBusy(true);
    setError('');
    try {
      const goingOnline = !profile.is_available;
      if (goingOnline) {
        await updateCurrentLocation(false);
        await setupBackgroundNotifications();
      }
      await apiPatch(`/providers/${profile.id}/availability`, { is_available: goingOnline }, true);
      await loadAll();
    } catch (err) {
      setError(err.message);
      await loadAll();
    } finally {
      setBusy(false);
    }
  }

  async function shareLocation() {
    setError('');
    try {
      await updateCurrentLocation(true);
    } catch (err) {
      setError(err.message);
    }
  }

  // Keep an online provider's location fresh so they stop matching after a
  // prolonged disconnect instead of being treated as if they were still nearby.
  useEffect(() => {
    if (!profile?.is_available) return undefined;

    // Refresh GPS every 15 seconds while online so customers receive a recent
    // provider position. The backend still rejects stale locations after 5 minutes.
    const id = setInterval(() => {
      updateCurrentLocation(false).catch(() => {});
    }, 15 * 1000);

    return () => clearInterval(id);
  }, [profile?.is_available, profile?.id]);

  async function acceptBooking() {
    setBusy(true);
    setError('');
    try {
      await apiPost(`/bookings/${activeBooking.id}/accept`, {}, true);
      stopBuzzer();
      loadAll();
    } catch (err) {
      setError(err.message);
      loadAll(); // it may already have timed out — refresh to clear it
    } finally {
      setBusy(false);
    }
  }

  async function declineBooking() {
    setBusy(true);
    setError('');
    try {
      await apiPost(`/bookings/${activeBooking.id}/decline`, {}, true);
      stopBuzzer();
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function startBooking() {
    setBusy(true);
    setError('');
    try {
      await apiPost(`/bookings/${activeBooking.id}/start`, { pin }, true);
      setPin('');
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function completeBooking() {
    setBusy(true);
    setError('');
    try {
      await apiPost(`/bookings/${activeBooking.id}/confirm-payment`, {
        fare_amount: Number(fareAmount),
        rating: rating || undefined,
        comment: comment || undefined,
      }, true);
      setFareAmount('');
      setRating(0);
      setComment('');
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="screen"><p>Loading...</p></div>;
  if (!profile) return <div className="screen"><p>Could not load profile.</p></div>;

  const jobMarker = activeBooking
    ? [{ lat: Number(activeBooking.pickup_lat), lng: Number(activeBooking.pickup_lng), emoji: '📍', color: '#EC4899' }]
    : [];
  const navigationMarkers = activeBooking && profile?.current_lat && profile?.current_lng
    ? [
        { lat: Number(profile.current_lat), lng: Number(profile.current_lng), emoji: '🏍', color: '#8B5CF6' },
        { lat: Number(activeBooking.pickup_lat), lng: Number(activeBooking.pickup_lng), emoji: '📍', color: '#EC4899' },
      ]
    : jobMarker;

  return (
    <div className="screen">
      <div className="dash-header">
        <div className="dash-avatar">{TYPE_ICON[profile.type] || '🔧'}</div>
        <div>
          <p className="dash-name">{profile.name}</p>
          <p className="dash-id">{profile.generated_id}</p>
        </div>
        <span className={`badge badge-${profile.kyc_status} dash-kyc`}>{profile.kyc_status}</span>
      </div>

      <div className="stat-grid">
        <div className="stat-tile"><p className="stat-label">Plan</p><p className="stat-value">{profile.plan_name || '—'}</p></div>
        <div className="stat-tile"><p className="stat-label">Left this cycle</p><p className="stat-value">{profile.pending_amount !== null ? `₹${Number(profile.pending_amount).toLocaleString('en-IN')}` : '—'}</p></div>
        <div className="stat-tile"><p className="stat-label">Rating</p><p className="stat-value">{profile.avg_rating} ★</p></div>
        <div className="stat-tile"><p className="stat-label">Status</p><p className="stat-value">{profile.is_available ? 'Online' : 'Offline'}</p></div>
      </div>

      {error && <p className="auth-error">{error}</p>}

      {!activeBooking && (
        <>
          <button className={profile.is_available ? 'availability-toggle online' : 'availability-toggle'} onClick={toggleAvailability} disabled={busy || profile.kyc_status !== 'approved'}>
            <span className="toggle-dot" />
            {profile.is_available ? "You're online — tap to go offline" : 'Tap to go available'}
          </button>
          {profile.kyc_status !== 'approved' && <p className="auth-error">KYC must be approved before you can go available.</p>}
          <button className="secondary" onClick={shareLocation}>📍 Update my location</button>
        </>
      )}

      {activeBooking && activeBooking.status === 'requested' && (
        <div className="buzz-card">
          <p className="buzz-title">🔔 New request!</p>
          {secondsLeft !== null && <p className="buzz-timer">{secondsLeft}s to respond</p>}
          <MapView markers={jobMarker} height={150} />
          <p className="pickup-line">📍 {activeBooking.pickup_location}</p>
          <div className="buzz-actions">
            <button className="decline-btn" onClick={declineBooking} disabled={busy}>Decline</button>
            <button className="accept-btn" onClick={acceptBooking} disabled={busy}>Accept</button>
          </div>
        </div>
      )}

      {activeBooking && activeBooking.status === 'accepted' && (
        <div className="job-card">
          <p className="job-label">On the way</p>
          <MapView markers={navigationMarkers} line={pickupRoute ? pickupRoute.line : null} height={190} />
          <p className="pickup-line">📍 {activeBooking.pickup_location}</p>
          {pickupRoute && <p className="route-info">🧭 {pickupRoute.distanceKm.toFixed(1)} km · about {pickupRoute.durationMin} min</p>}
          <p className="provider-line">{activeBooking.customer_name || 'Customer'} · {activeBooking.customer_phone}</p>
          <p className="route-info">Navigation is running inside Gofixo. Keep this screen open while travelling.</p>
          <label>Enter customer's PIN to start</label>
          <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4-digit PIN" inputMode="numeric" />
          <button className="cta" onClick={startBooking} disabled={busy || pin.length < 4}>Start</button>
        </div>
      )}

      {activeBooking && activeBooking.status === 'ongoing' && (
        <div className="job-card">
          <p className="job-label">In progress</p>
          <p className="pickup-line">📍 {activeBooking.pickup_location}</p>
          <label>Fare amount (₹)</label>
          <input value={fareAmount} onChange={(e) => setFareAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Calculated fare" inputMode="decimal" />
          {activeBooking.fare_amount && <p className="route-info">Customer estimate: ₹{Number(activeBooking.fare_amount).toLocaleString('en-IN')}</p>}
          <label>Rate the customer</label>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={n <= rating ? 'star active' : 'star'} onClick={() => setRating(n)}>★</button>
            ))}
          </div>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment" />
          <button className="cta" onClick={completeBooking} disabled={busy || !fareAmount}>Confirm payment received</button>
        </div>
      )}
    </div>
  );
}
