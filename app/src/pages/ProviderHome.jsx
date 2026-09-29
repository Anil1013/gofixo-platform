import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../api';
import MapView from '../components/MapView';
import { getRoute } from '../utils/geo';
import { startBuzzer, stopBuzzer } from '../utils/buzzer';
import ProfilePhoto from '../components/ProfilePhoto';

const TYPE_ICON = { bike: '🏍', auto: '🛺', car: '🚗', general_worker: '🧹', skilled_worker: '🔧' };
const OFFER_SECONDS = 60;

export default function ProviderHome({ onLogout }) {
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
  const autoOnlineAttemptRef = useRef(false);

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
    const interval = setInterval(loadAll, 2000);
    return () => clearInterval(interval);
  }, []);

  // Keep the provider's phone screen awake while the partner app is open.
  // Wake Lock is released by the browser when the page is hidden, so we
  // reacquire it automatically when the app becomes visible again.
  useEffect(() => {
    let wakeLock = null;
    let stopped = false;

    async function requestWakeLock() {
      if (stopped || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
          if (!stopped && document.visibilityState === 'visible') {
            requestWakeLock();
          }
        });
      } catch {
        // Some browsers/OS versions may not support screen wake lock.
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') requestWakeLock();
      else if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
      }
    };

    requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLock) wakeLock.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    // Opening the partner app puts an approved provider back on duty automatically.
    // This runs only once per app session, so a manual Offline tap is respected
    // for the rest of that session. A fresh app launch will go online again.
    if (!profile || autoOnlineAttemptRef.current) return;
    autoOnlineAttemptRef.current = true;
    if (profile.kyc_status !== 'approved' || profile.is_available || activeBooking) return;

    (async () => {
      try {
        await updateCurrentLocation(false);
        await apiPatch('/providers/' + profile.id + '/availability', { is_available: true }, true);
        await loadAll();
      } catch {
        await loadAll();
      }
    })();
  }, [profile?.id, profile?.kyc_status, profile?.is_available, activeBooking?.id]);

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
      startBuzzer(60 * 1000);
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

  useEffect(() => {
    if (profile?.is_available) setupBackgroundNotifications();
  }, [profile?.is_available]);

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
    const activeTrip = ['accepted', 'ongoing'].includes(activeBooking?.status);
    if (!profile?.is_available && !activeTrip) return undefined;

    // Keep GPS flowing while online and throughout an active booking. The
    // backend broadcasts each update to the customer's live WebSocket.
    updateCurrentLocation(false).catch(() => {});
    const id = setInterval(() => {
      updateCurrentLocation(false).catch(() => {});
    }, 5 * 1000);

    return () => clearInterval(id);
  }, [profile?.is_available, profile?.id, activeBooking?.status]);

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
      await updateCurrentLocation(false).catch(() => {});
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

  const providerTypeLabel = profile.type === 'general_worker' ? 'Home Services' : profile.type === 'skilled_worker' ? 'Skilled Expert' : (profile.type || 'bike').replaceAll('_', ' ');
  const ratingValue = profile.avg_rating ? Number(profile.avg_rating).toFixed(1) : '—';

  return (
    <div className="screen provider-home-screen">
      <header className="partner-app-header">
        <div className="partner-logo"><span className="partner-logo-pin" /><strong>Gofi<span>xo</span></strong></div>
        <button type="button" className={profile.is_available ? 'partner-online-toggle online' : 'partner-online-toggle'} onClick={toggleAvailability} disabled={busy || profile.kyc_status !== 'approved'}>
          <span>{profile.is_available ? 'Online' : 'Offline'}</span><i />
        </button>
      </header>

      <section className="partner-profile-card">
        <div className="partner-avatar">
          <ProfilePhoto role="provider" userId={profile.id} size="compact" />
          <b />
        </div>
        <div className="partner-profile-copy">
          <h1>{profile.name}</h1>
          <div className="partner-rating"><span>★</span> {ratingValue} <small>({Number(profile.today_rides || 0)} rides today)</small></div>
          <p>{providerTypeLabel} · {profile.generated_id}</p>
        </div>
        <button type="button" className="partner-profile-logout" onClick={onLogout} title="Log out">↪</button>
      </section>

      <div className="partner-stat-row">
        <div><span className="stat-icon blue">▣</span><strong>{Number(profile.today_rides || 0)}</strong><small>Today Rides</small></div>
        <div><span className="stat-icon green">▰</span><strong>₹{Number(profile.total_earned_this_cycle || 0).toLocaleString('en-IN')}</strong><small>Earnings</small></div>
        <div><span className="stat-icon orange">★</span><strong>{ratingValue}</strong><small>Rating</small></div>
      </div>

      {error && <p className="auth-error">{error}</p>}

      <section className="keep-going-card">
        <div className="keep-going-icon">🏆</div>
        <div><strong>Keep Going!</strong><p>You are doing great today. Stay online and earn more.</p></div>
        <span>›</span>
      </section>

      {activeBooking && activeBooking.status === 'requested' ? (
        <section className="reference-request-card">
          <div className="reference-section-head">
            <h2>Incoming Bookings</h2><button type="button">See all →</button>
          </div>
          <div className="reference-ride-card">
            <div className="reference-ride-top">
              <div className="ride-type-icon">🏍️</div>
              <div><strong>New Ride Request</strong><small>{secondsLeft !== null ? `${secondsLeft}s left` : 'Just now'}</small></div>
            </div>
            <div className="reference-route-line">
              <div><span className="pickup-dot" /><strong>{activeBooking.pickup_location}</strong></div>
              <div><span className="drop-dot" /><strong>{activeBooking.drop_or_service_address || 'Destination'}</strong></div>
            </div>
            <div className="reference-fare-row">
              <strong>₹{Number(activeBooking.fare_amount || 0).toLocaleString('en-IN')}</strong>
              <small>{activeBooking.route_distance_km ? Number(activeBooking.route_distance_km).toFixed(1) + ' km' : 'Nearby'}</small>
            </div>
            <div className="reference-request-actions">
              <button className="reject-reference" onClick={declineBooking} disabled={busy}>Reject</button>
              <button className="accept-reference" onClick={acceptBooking} disabled={busy}>Accept</button>
            </div>
          </div>
          <div className="reference-map-card">
            <MapView markers={jobMarker} height={190} />
          </div>
          <div className="reference-online-footer"><span /><div><strong>You are Online</strong><small>Getting ride requests nearby</small></div><button type="button" onClick={toggleAvailability}>Go Offline</button></div>
        </section>
      ) : (
        <section className="reference-request-card">
          <div className="reference-section-head">
            <h2>Incoming Bookings</h2><button type="button">See all →</button>
          </div>
          <div className="waiting-request">
            <div className="ride-type-icon">🏍️</div>
            <div><strong>Waiting for your next ride</strong><small>Stay online and nearby requests will appear here.</small></div>
          </div>
        </section>
      )}

      {!activeBooking && (
        <section className="provider-benefits reference-benefits">
          <span className="section-kicker">GOFIXO PARTNER</span>
          <h2>Keep Growing!</h2>
          <p className="partner-motivation">Stay online, accept nearby jobs and build your earnings every day.</p>
          <div className="benefit-grid">
            <div><span>🏆</span><strong>Nearby jobs</strong><small>Smart matching</small></div>
            <div><span>💰</span><strong>Clear earnings</strong><small>Know your fare</small></div>
            <div><span>🛡️</span><strong>Built for trust</strong><small>Verified customers</small></div>
          </div>
        </section>
      )}

      {activeBooking && activeBooking.status === 'accepted' && (
        <section className="provider-job-panel">
          <div className="job-panel-head"><div><span className="section-kicker">PICKUP</span><h2>On the way</h2></div><span className="job-live-pill">● LIVE</span></div>
          <MapView markers={navigationMarkers} line={pickupRoute ? pickupRoute.line : null} height={200} />
          <div className="job-location-row"><span>📍</span><div><small>PICKUP</small><strong>{activeBooking.pickup_location}</strong></div></div>
          {pickupRoute && <div className="route-highlight"><strong>{pickupRoute.distanceKm.toFixed(1)} km</strong><span>about {pickupRoute.durationMin} min</span></div>}
          <div className="customer-card"><span className="customer-avatar">👤</span><div><small>CUSTOMER</small><strong>{activeBooking.customer_name || 'Customer'}</strong><span>{activeBooking.customer_phone}</span></div></div>
          <p className="route-info">🧭 Navigation is running inside Gofixo. Keep this screen open while travelling.</p>
          <label>Customer start PIN</label>
          <input className="provider-input" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0,4))} placeholder="Enter 4-digit PIN" inputMode="numeric" />
          <button className="cta provider-main-cta" onClick={startBooking} disabled={busy || pin.length < 4}>Start trip →</button>
        </section>
      )}

      {activeBooking && activeBooking.status === 'ongoing' && (
        <section className="provider-job-panel">
          <div className="job-panel-head"><div><span className="section-kicker">TRIP IN PROGRESS</span><h2>Complete the booking</h2></div><span className="job-live-pill">● ONGOING</span></div>
          <div className="earning-highlight"><span>YOUR FARE</span><strong>₹{fareAmount || '—'}</strong><small>Confirm the amount received from customer</small></div>
          <label>Fare amount (₹)</label>
          <input className="provider-input" value={fareAmount} onChange={(e) => setFareAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Enter final fare" inputMode="decimal" />
          {activeBooking.fare_amount && <p className="route-info">Customer estimate: ₹{Number(activeBooking.fare_amount).toLocaleString('en-IN')}</p>}
          <label>Rate the customer</label>
          <div className="stars provider-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={n <= rating ? 'star active' : 'star'} onClick={() => setRating(n)}>★</button>
            ))}
          </div>
          <input className="provider-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional feedback" maxLength={500} />
          <button className="cta provider-main-cta" onClick={completeBooking} disabled={busy || !fareAmount}>Confirm payment received →</button>
        </section>
      )}
    </div>
  );
}
