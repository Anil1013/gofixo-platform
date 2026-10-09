import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import ProfilePhoto from '../components/ProfilePhoto';

export default function History() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet('/bookings/mine', true)
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
            {b.provider_id && b.provider_name && ['accepted', 'arrived', 'ongoing', 'completed'].includes(b.status) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <ProfilePhoto role="provider" userId={b.provider_id} size="compact" editable={false} />
                <strong>{b.provider_name}</strong>
              </div>
            )}
            <p className="history-title">{b.service_type === 'ride' ? '🏍 Ride' : `🔧 ${String(b.service_category || 'Home Services').replaceAll('_', ' ')}`} · {b.pickup_location}</p>
            {b.service_type === 'services' && b.service_description && <p className="history-sub">{b.service_description}</p>}
            <p className="history-sub">{new Date(b.created_at).toLocaleDateString()} {b.provider_name ? `· ${b.provider_name}` : ''}</p>
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
