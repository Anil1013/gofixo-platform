import { useEffect, useState } from 'react';
import { apiGet } from '../api';

export default function Bookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiGet('/bookings')
      .then(setBookings)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading bookings...</p>;
  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>;

  return (
    <div>
      <h2>Bookings ({bookings.length})</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Service</th>
            <th>Provider</th>
            <th>Customer</th>
            <th>Fare</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id}>
              <td>{b.id}</td>
              <td>{b.service_type}</td>
              <td>
                {b.provider_generated_id ? (
                  <>
                    <div>{b.provider_generated_id}</div>
                    <div className="sub-line">{b.provider_name} · {b.provider_phone}</div>
                  </>
                ) : '—'}
              </td>
              <td>
                {b.customer_id ? (
                  <>
                    <div>Cust #{b.customer_id}</div>
                    <div className="sub-line">{b.customer_name || '—'} · {b.customer_phone}</div>
                  </>
                ) : '—'}
              </td>
              <td>{b.fare_amount ? `₹${b.fare_amount}` : '—'}</td>
              <td>
                <span className={`badge badge-${b.status}`}>{b.status}</span>
              </td>
              <td>{new Date(b.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {bookings.length === 0 && (
            <tr>
              <td colSpan="7">No bookings yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
