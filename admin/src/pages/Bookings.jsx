import { useEffect, useState } from 'react';
import { apiGet, apiGetBlob } from '../api';


function AdminPhoto({ kind, id, documentId }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!id && !documentId) return undefined;
    let active = true; let url = '';
    const path = kind === 'customer'
      ? `/admin/customers/${id}/profile-photo`
      : `/providers/admin/${id}/documents/${documentId}`;
    if (kind === 'provider' && !documentId) return undefined;
    apiGetBlob(path).then((blob) => { if (active) { url = URL.createObjectURL(blob); setSrc(url); } }).catch(() => {});
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [kind, id, documentId]);
  return src ? <img src={src} alt="" style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#EAFBF2' }}>👤</div>;
}

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
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead><tr>
            <th>#</th><th>Service</th><th>Provider</th><th>Provider photo</th><th>Customer</th><th>Customer photo</th>
            <th>Pickup</th><th>Destination / Service</th><th>Distance</th>
            <th>Fare</th><th>Status</th><th>Created</th><th>Completed</th>
          </tr></thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.id}>
                <td>{b.id}</td>
                <td><div>{b.service_type}</div>{b.service_category && <div className="sub-line">{String(b.service_category).replaceAll('_', ' ')}</div>}</td>
                <td>{b.provider_generated_id ? <><div>{b.provider_generated_id}</div><div className="sub-line">{b.provider_name} · {b.provider_phone}</div></> : '—'}</td>
                <td><AdminPhoto kind="provider" id={b.provider_id} documentId={b.provider_profile_photo_document_id} /></td>
                <td>{b.customer_id ? <><div>Cust #{b.customer_id}</div><div className="sub-line">{b.customer_name || '—'} · {b.customer_phone}</div></> : '—'}</td>
                <td><AdminPhoto kind="customer" id={b.customer_id} /></td>
                <td style={{ minWidth: 220 }}>{b.pickup_location || '—'}</td>
                <td style={{ minWidth: 220 }}>
                  {b.drop_or_service_address || '—'}
                  {b.drop_lat != null && b.drop_lng != null && <div className="sub-line">{Number(b.drop_lat).toFixed(6)}, {Number(b.drop_lng).toFixed(6)}</div>}
                </td>
                <td>{b.route_distance_km ? `${Number(b.route_distance_km).toFixed(1)} km` : '—'}</td>
                <td>{b.fare_amount ? `₹${b.fare_amount}` : '—'}</td>
                <td><span className={`badge badge-${b.status}`}>{b.status}</span></td>
                <td>{b.created_at ? new Date(b.created_at).toLocaleString() : '—'}</td>
                <td>{b.completed_at ? new Date(b.completed_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
            {bookings.length === 0 && <tr><td colSpan="13">No bookings yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}