import { useEffect, useState } from 'react';
import { apiGet, apiPatch } from '../api';

const DOC_LABELS = {
  aadhar: 'Aadhar',
  driving_license: 'DL',
  vehicle_rc: 'RC',
  vehicle_photo: 'Vehicle photo',
  profile_photo: 'Profile photo',
  police_verification: 'Police verif.',
};

export default function Providers() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);

  function load() {
    setLoading(true);
    apiGet('/providers')
      .then(setProviders)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function updateKyc(id, status) {
    setUpdatingId(id);
    try {
      await apiPatch(`/providers/${id}/kyc`, { status });
      load();
    } catch (e) {
      alert(`Failed to update: ${e.message}`);
    } finally {
      setUpdatingId(null);
    }
  }

  if (loading) return <p>Loading providers...</p>;
  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>;

  return (
    <div>
      <h2>Providers ({providers.length})</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Phone</th>
            <th>Type</th>
            <th>KYC</th>
            <th>Plan</th>
            <th>Pending</th>
            <th>Documents</th>
            <th>Rating</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.id}>
              <td>{p.generated_id}</td>
              <td>{p.name}</td>
              <td>{p.phone}</td>
              <td>{p.type}</td>
              <td>
                <span className={`badge badge-${p.kyc_status}`}>{p.kyc_status}</span>
              </td>
              <td>{p.plan_name ? p.plan_name : <span style={{ color: '#B0A8BE' }}>none</span>}</td>
              <td>
                {p.pending_amount !== null
                  ? `₹${Number(p.pending_amount).toLocaleString('en-IN')} left`
                  : '—'}
              </td>
              <td>
                {p.documents && p.documents.length > 0 ? (
                  <div className="doc-links">
                    {p.documents.map((d, i) => (
                      <a key={i} href={`https://gofixo.mob13r.com${d.file_url}`} target="_blank" rel="noreferrer">
                        {DOC_LABELS[d.doc_type] || d.doc_type}
                      </a>
                    ))}
                  </div>
                ) : (
                  <span style={{ color: '#B0A8BE' }}>none uploaded</span>
                )}
              </td>
              <td>{p.avg_rating} ★</td>
              <td>
                {p.kyc_status !== 'approved' && (
                  <button
                    className="btn btn-approve"
                    disabled={updatingId === p.id}
                    onClick={() => updateKyc(p.id, 'approved')}
                  >
                    Approve
                  </button>
                )}
                {p.kyc_status !== 'rejected' && (
                  <button
                    className="btn btn-reject"
                    disabled={updatingId === p.id}
                    onClick={() => updateKyc(p.id, 'rejected')}
                  >
                    Reject
                  </button>
                )}
              </td>
            </tr>
          ))}
          {providers.length === 0 && (
            <tr>
              <td colSpan="10">No providers registered yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
