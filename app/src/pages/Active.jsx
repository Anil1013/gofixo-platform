import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';

const STEPS = [
  { key: 'requested', label: 'Requested', icon: '🔍' },
  { key: 'ongoing', label: 'In progress', icon: '🚦' },
  { key: 'completed', label: 'Completed', icon: '✅' },
];

function stepIndex(status) {
  return STEPS.findIndex((s) => s.key === status);
}

export default function Active({ booking, onRefresh, onDone }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [rated, setRated] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (booking.status === 'completed') return;
    const interval = setInterval(onRefresh, 6000);
    return () => clearInterval(interval);
  }, [booking.status]);

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

  const current = stepIndex(booking.status);

  return (
    <div className="screen">
      <h2>{booking.service_type === 'ride' ? '🏍 Your ride' : '🔧 Your service'}</h2>

      <div className="stepper">
        {STEPS.map((s, i) => (
          <div key={s.key} className={`step ${i <= current ? 'done' : ''} ${i === current ? 'current' : ''}`}>
            <span className="step-icon">{s.icon}</span>
            <span className="step-label">{s.label}</span>
            {i < STEPS.length - 1 && <span className="step-line" />}
          </div>
        ))}
      </div>

      <div className="status-card">
        <p className="pickup-line">📍 {booking.pickup_location}</p>
        {booking.provider_name && (
          <p className="provider-line">
            {booking.provider_name} · <span className="id-chip">{booking.provider_generated_id}</span>
          </p>
        )}
      </div>

      {booking.status !== 'completed' && (
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
        </div>
      )}

      {booking.status === 'completed' && rated && (
        <div className="thanks-card">
          <p>🎉 Thanks for your feedback!</p>
        </div>
      )}

      {booking.status === 'completed' && (
        <button className="secondary" onClick={onDone}>Book another</button>
      )}
    </div>
  );
}
