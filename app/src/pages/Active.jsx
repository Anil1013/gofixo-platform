import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';

const STATUS_LABELS = {
  requested: 'Finding your provider is on the way',
  ongoing: 'In progress',
  completed: 'Completed',
};

export default function Active({ booking, onRefresh, onDone }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [rated, setRated] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (booking.status === 'completed') return;
    const interval = setInterval(onRefresh, 6000); // poll for status changes
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

  return (
    <div className="screen">
      <h2>Your booking</h2>

      <div className="status-card">
        <span className={`badge badge-${booking.status}`}>{STATUS_LABELS[booking.status] || booking.status}</span>
        <p className="pickup-line">{booking.pickup_location}</p>
        {booking.provider_name && (
          <p className="provider-line">
            {booking.provider_name} · {booking.provider_generated_id}
          </p>
        )}
      </div>

      {booking.status !== 'completed' && (
        <div className="pin-card">
          <p className="pin-label">Share this PIN with your provider on arrival</p>
          <p className="pin-value">{booking.start_pin}</p>
        </div>
      )}

      {booking.status === 'completed' && !rated && (
        <div className="rating-card">
          <p>Fare: ₹{booking.fare_amount}</p>
          <p>How was it?</p>
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
        <p className="thanks">Thanks for your feedback!</p>
      )}

      {booking.status === 'completed' && (
        <button className="secondary" onClick={onDone}>Book another</button>
      )}
    </div>
  );
}
