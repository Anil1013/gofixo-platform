import { useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../api';

const TYPE_ICON = { bike: '🏍', auto: '🛺', car: '🚗', general_worker: '🧹', skilled_worker: '🔧' };

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

  async function loadAll() {
    try {
      const [me, bookings] = await Promise.all([
        apiGet('/providers/me', true),
        apiGet('/bookings/mine/provider', true),
      ]);
      setProfile(me);
      const active = bookings.find((b) => b.status === 'requested' || b.status === 'ongoing');
      setActiveBooking(active || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 8000);
    return () => clearInterval(interval);
  }, []);

  async function toggleAvailability() {
    setBusy(true);
    setError('');
    try {
      await apiPatch(`/providers/${profile.id}/availability`, { is_available: !profile.is_available }, true);
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function shareLocation() {
    if (!navigator.geolocation) {
      setError('Location not available on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await apiPatch(`/providers/${profile.id}/location`, { lat: pos.coords.latitude, lng: pos.coords.longitude }, true);
          loadAll();
        } catch (err) {
          setError(err.message);
        }
      },
      () => setError('Could not get your location.')
    );
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
        <div className="stat-tile">
          <p className="stat-label">Plan</p>
          <p className="stat-value">{profile.plan_name || '—'}</p>
        </div>
        <div className="stat-tile">
          <p className="stat-label">Left this cycle</p>
          <p className="stat-value">{profile.pending_amount !== null ? `₹${Number(profile.pending_amount).toLocaleString('en-IN')}` : '—'}</p>
        </div>
        <div className="stat-tile">
          <p className="stat-label">Rating</p>
          <p className="stat-value">{profile.avg_rating} ★</p>
        </div>
        <div className="stat-tile">
          <p className="stat-label">Status</p>
          <p className="stat-value">{profile.is_available ? 'Online' : 'Offline'}</p>
        </div>
      </div>

      {error && <p className="auth-error">{error}</p>}

      {!activeBooking && (
        <>
          <button
            className={profile.is_available ? 'availability-toggle online' : 'availability-toggle'}
            onClick={toggleAvailability}
            disabled={busy || profile.kyc_status !== 'approved'}
          >
            <span className="toggle-dot" />
            {profile.is_available ? "You're online — tap to go offline" : 'Tap to go available'}
          </button>
          {profile.kyc_status !== 'approved' && (
            <p className="auth-error">KYC must be approved before you can go available.</p>
          )}
          <button className="secondary" onClick={shareLocation}>📍 Update my location</button>
        </>
      )}

      {activeBooking && activeBooking.status === 'requested' && (
        <div className="job-card">
          <p className="job-label">New booking</p>
          <p className="pickup-line">📍 {activeBooking.pickup_location}</p>
          <p className="provider-line">{activeBooking.customer_name || 'Customer'} · {activeBooking.customer_phone}</p>
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
          <input value={fareAmount} onChange={(e) => setFareAmount(e.target.value)} placeholder="e.g. 120" inputMode="numeric" />
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
