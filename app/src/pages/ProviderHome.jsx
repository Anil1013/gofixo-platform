import { useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../api';

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
      <h2>Your dashboard</h2>

      <div className="status-card">
        <p className="pickup-line">{profile.generated_id} · {profile.type}</p>
        <span className={`badge badge-${profile.kyc_status}`}>{profile.kyc_status}</span>
        {profile.plan_name ? (
          <p className="provider-line" style={{ marginTop: 8 }}>
            Plan: {profile.plan_name} · ₹{Number(profile.pending_amount).toLocaleString('en-IN')} left this cycle
          </p>
        ) : (
          <p className="provider-line" style={{ marginTop: 8 }}>No active plan — subscribe to go available</p>
        )}
      </div>

      {error && <p className="auth-error">{error}</p>}

      {!activeBooking && (
        <>
          <button className="cta" onClick={toggleAvailability} disabled={busy || profile.kyc_status !== 'approved'}>
            {profile.is_available ? 'Go offline' : 'Go available'}
          </button>
          {profile.kyc_status !== 'approved' && (
            <p className="auth-error">KYC must be approved before you can go available.</p>
          )}
          <button className="secondary" onClick={shareLocation}>📍 Update my location</button>
        </>
      )}

      {activeBooking && activeBooking.status === 'requested' && (
        <div className="pin-card" style={{ background: 'white', color: 'var(--text)', border: '1px solid var(--line)' }}>
          <p className="pin-label" style={{ color: 'var(--text-dim)' }}>New booking — {activeBooking.pickup_location}</p>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
            {activeBooking.customer_name || 'Customer'} · {activeBooking.customer_phone}
          </p>
          <label>Enter customer's PIN to start</label>
          <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4-digit PIN" inputMode="numeric" />
          <button className="cta" onClick={startBooking} disabled={busy || pin.length < 4}>Start</button>
        </div>
      )}

      {activeBooking && activeBooking.status === 'ongoing' && (
        <div className="rating-card">
          <p>In progress — {activeBooking.pickup_location}</p>
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
