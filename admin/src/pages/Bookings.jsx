import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [totalBookings, setTotalBookings] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet('/bookings?page=1&limit=50');
      setBookings(Array.isArray(data?.items) ? data.items : []);
      setTotalBookings(Number(data?.total || 0));
      setHasMore(!!data?.hasMore);
    } catch (e) {
      setError(e.message || 'Bookings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const nextPage = Math.floor(bookings.length / 50) + 1;
      const data = await apiGet('/bookings?page=' + nextPage + '&limit=50');
      const nextItems = Array.isArray(data?.items) ? data.items : [];
      setBookings((current) => [...current, ...nextItems]);
      setTotalBookings(Number(data?.total || 0));
      setHasMore(!!data?.hasMore);
    } catch (e) {
      setError(e.message || 'More bookings could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => { load(); }, [load]);

  const visibleBookings = useMemo(() => {
    const query = search.trim().toLowerCase();
    return bookings.filter((booking) => {
      const matchesStatus = status === 'all' || String(booking.status || '').toLowerCase() === status;
      const matchesSearch = !query || [
        booking.id, booking.service_type, booking.service_category, booking.provider_name,
        booking.provider_generated_id, booking.provider_phone, booking.customer_name,
        booking.customer_id, booking.customer_phone, booking.pickup_location, booking.drop_or_service_address,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [bookings, search, status]);

  return (
    <div>
      <div className="page-head-row">
        <div><h2>Bookings ({visibleBookings.length} shown / {totalBookings} total)</h2><p className="page-subtitle">Search by booking, customer, partner or service. Times are shown in IST.</p></div>
        <button className="btn btn-approve" type="button" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh bookings'}</button>
      </div>
      <div className="payments-toolbar">
        <label className="payments-search">Search bookings<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Booking ID, name, phone, service, address…" /></label>
        <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option><option value="requested">Requested</option><option value="accepted">Accepted</option><option value="arrived">Arrived</option><option value="ongoing">Ongoing</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no_provider">No provider</option>
        </select></label>
      </div>
      {error && <div className="topup-alert topup-alert-error" role="alert">{error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead><tr>
            <th>Sr. No.</th><th>Booking ID</th><th>Service</th><th>Provider</th><th>Provider photo</th><th>Customer</th><th>Customer photo</th>
            <th>Pickup</th><th>Destination / Service</th><th>Distance</th>
            <th>Fare</th><th>Payment</th><th>Platform fee</th><th>Partner earning</th><th>Payout</th><th>Status</th><th>Created</th><th>Completed</th>
          </tr></thead>
          <tbody>
            {visibleBookings.map((b, index) => (
              <tr key={b.id}>
                <td>{index + 1}</td><td>{b.id}</td>
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
                <td>{b.fare_amount != null ? `₹${Number(b.fare_amount).toFixed(2)}` : '—'}</td>
                <td><div>{b.payment_method || '—'}</div><div className="sub-line">{b.payment_status || 'unpaid / pending'}</div></td>
                <td>{b.commission_amount != null ? `₹${Number(b.commission_amount).toFixed(2)}` : '—'}</td>
                <td>{b.provider_earning_amount != null ? `₹${Number(b.provider_earning_amount).toFixed(2)}` : '—'}</td>
                <td>{b.partner_payout_status ? String(b.partner_payout_status).replaceAll('_', ' ') : (b.service_type === 'services' && b.status === 'completed' ? 'Not recorded' : '—')}</td>
                <td><span className={`badge badge-${b.status}`}>{b.status}</span></td>
                <td>{b.created_at ? new Date(b.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : '—'}</td>
                <td>{b.completed_at ? new Date(b.completed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : '—'}</td>
              </tr>
            ))}
            {visibleBookings.length === 0 && <tr><td colSpan="18">{bookings.length === 0 ? 'No bookings yet.' : 'No bookings match this search or status.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
          <button className="btn btn-light" type="button" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading more…' : 'Load 50 more bookings'}
          </button>
        </div>
      )}
    </div>
  );
}