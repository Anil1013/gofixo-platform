import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../api';

export default function Wallet() {
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet('/bookings/mine', true).then(setBookings).catch((err) => setError(err.message));
  }, []);

  const completed = useMemo(
    () => bookings.filter((b) => b.status === 'completed'),
    [bookings]
  );
  const spent = completed.reduce((sum, b) => sum + Number(b.fare_amount || b.estimated_fare || 0), 0);

  return (
    <div className="screen wallet-screen">
      <div className="wallet-head">
        <span className="section-kicker">GOFIXO WALLET</span>
        <h1>Wallet</h1>
        <p>Your completed ride and service payments.</p>
      </div>
      <section className="wallet-balance-card">
        <span>Total paid</span>
        <strong>₹{spent.toLocaleString('en-IN')}</strong>
        <small>{completed.length} completed booking{completed.length === 1 ? '' : 's'}</small>
      </section>
      {error && <p className="auth-error">{error}</p>}
      <section className="wallet-transactions">
        <div className="reference-section-title"><h2>Recent payments</h2></div>
        {completed.length === 0 ? (
          <div className="wallet-empty">
            <strong>No completed payments yet</strong>
            <small>Your completed rides and home services will appear here.</small>
          </div>
        ) : completed.slice(0, 12).map((booking) => (
          <div className="wallet-row" key={booking.id}>
            <span>₹</span>
            <div><strong>{booking.drop_or_service_address || 'Gofixo booking'}</strong><small>{booking.service_type === 'services' ? 'Home service' : 'Ride'}</small></div>
            <b>₹{Number(booking.fare_amount || booking.estimated_fare || 0).toLocaleString('en-IN')}</b>
          </div>
        ))}
      </section>
    </div>
  );
}
