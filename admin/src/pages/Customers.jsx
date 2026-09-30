import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';

function maskAadhaar(value) {
  if (!value) return 'Not collected';
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `•••• •••• ${digits.slice(-4)}`;
}

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resetting, setResetting] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet('/admin/customers');
      setCustomers(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function openCustomer(id) {
    try {
      setError('');
      setSelected(await apiGet(`/admin/customers/${id}`));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function resetPassword() {
    if (!selected?.customer?.id) return;
    const first = window.prompt('Enter a new password (minimum 8 characters, letters + numbers):');
    if (!first) return;
    const second = window.prompt('Confirm the new password:');
    if (first !== second) {
      alert('Passwords do not match.');
      return;
    }

    setResetting(true);
    try {
      await apiPost(`/admin/customers/${selected.customer.id}/reset-password`, { new_password: first });
      alert('Customer password reset successfully.');
      await openCustomer(selected.customer.id);
      await load();
    } catch (e) {
      alert(`Password reset failed: ${e.message}`);
    } finally {
      setResetting(false);
    }
  }

  const query = search.trim().toLowerCase();
  const visible = customers.filter((c) =>
    !query || [c.id, c.name, c.phone].some((v) => String(v || '').toLowerCase().includes(query))
  );

  if (loading) return <p>Loading customers...</p>;

  return (
    <div className="customer-admin-page">
      <div className="page-head-row">
        <div>
          <h2>Customers ({customers.length})</h2>
          <p className="page-subtitle">Customer accounts and password-reset requests.</p>
        </div>
        <input
          className="admin-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ID / name / phone"
        />
      </div>

      {error && <div className="admin-error">{error}</div>}

      {selected ? (
        <section className="customer-detail-card">
          <div className="detail-head">
            <div>
              <span className="detail-kicker">CUSTOMER DETAILS</span>
              <h3>{selected.customer.name || 'Unnamed customer'}</h3>
              <p>Customer ID #{selected.customer.id}</p>
            </div>
            <button className="btn btn-light" onClick={() => setSelected(null)}>← Back to customers</button>
          </div>

          <div className="customer-detail-grid">
            <div><span>Customer ID</span><strong>#{selected.customer.id}</strong></div>
            <div><span>Name</span><strong>{selected.customer.name || '—'}</strong></div>
            <div><span>Phone number</span><strong>{selected.customer.phone}</strong></div>
            <div><span>Aadhaar card</span><strong>{maskAadhaar(selected.customer.aadhaar_number)}</strong></div>
            <div>
              <span>Password</span>
              <strong className="password-protected">••••••••••</strong>
              <small>Passwords are stored as bcrypt hashes and cannot be displayed.</small>
            </div>
            <div><span>Password status</span><strong>{selected.customer.has_password ? 'Set' : 'Not set'}</strong></div>
          </div>

          <div className="reset-panel">
            <div>
              <strong>Password reset</strong>
              <p>
                {selected.reset_requests?.some((r) => r.status === 'pending')
                  ? 'This customer has a pending forgot-password request.'
                  : 'Admin can set a new password without knowing the old password.'}
              </p>
            </div>
            <button className="btn btn-approve" disabled={resetting} onClick={resetPassword}>
              {resetting ? 'Resetting...' : 'Set new password'}
            </button>
          </div>

          {selected.reset_requests?.length > 0 && (
            <div className="reset-history">
              <h4>Reset requests</h4>
              {selected.reset_requests.map((r) => (
                <div key={r.id}>
                  <span>Request #{r.id}</span>
                  <span className={`badge badge-${r.status}`}>{r.status}</span>
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>ID</th><th>Name</th><th>Phone</th><th>Password</th><th>Reset request</th><th>Action</th></tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id}>
                <td>#{c.id}</td>
                <td>{c.name || '—'}</td>
                <td>{c.phone}</td>
                <td>{c.has_password ? 'Set' : 'Not set'}</td>
                <td>{c.reset_requested ? <span className="badge badge-pending">pending</span> : '—'}</td>
                <td><button className="btn btn-view" onClick={() => openCustomer(c.id)}>View details</button></td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan="6">No customers found.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
