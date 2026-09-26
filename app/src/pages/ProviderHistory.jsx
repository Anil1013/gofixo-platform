import { useEffect, useState } from 'react';
import { apiGet } from '../api';

export default function ProviderHistory() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet('/bookings/mine/provider', true)
      .then(setBookings)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="screen"><p>Loading...</p></div>;

  return (
    <div className="screen">
      <h2>History</h2>
      {bookings.length === 0 && <p>No bookings yet.</p>}
      {bookings.map((b) => (
        <div key={b.id} className="history-item">
          <div>
            <p className="history-title">{b.service_type === 'ride' ? '🏍 Ride' : '🔧 Pronto'} · {b.pickup_location}</p>
            <p className="history-sub">{new Date(b.created_at).toLocaleDateString()} {b.customer_name ? `· ${b.customer_name}` : ''}</p>
          </div>
          <div className="history-right">
            <span className={`badge badge-${b.status}`}>{b.status}</span>
            {b.fare_amount && <p className="history-fare">₹{b.fare_amount}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
