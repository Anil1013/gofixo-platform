import { useEffect, useState } from 'react';
import { apiGet, apiGetBlob, apiPatch } from '../api';

const DOC_LABELS = {
  aadhar_front: 'Aadhar front',
  aadhar_back: 'Aadhar back',
  driving_license: 'DL',
  vehicle_rc: 'RC',
  vehicle_photo_front: 'Vehicle front',
  vehicle_photo_back: 'Vehicle back',
  profile_photo: 'Profile photo',
  police_verification: 'Police verif.',
};

export default function Providers() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [search, setSearch] = useState('');
  const [documentViewer, setDocumentViewer] = useState(null);
  const [documentLoading, setDocumentLoading] = useState(false);

  function load() {
    setLoading(true);
    apiGet('/providers')
      .then(setProviders)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function viewDocument(providerId, documentId, label) {
    setDocumentLoading(true);
    try {
      const blob = await apiGetBlob(`/providers/admin/${providerId}/documents/${documentId}`);
      const url = URL.createObjectURL(blob);
      setDocumentViewer({ url, label: label || 'KYC document', type: blob.type || 'application/octet-stream' });
    } catch (e) {
      alert(`Failed to open document: ${e.message}`);
    } finally {
      setDocumentLoading(false);
    }
  }

  function closeDocumentViewer() {
    if (documentViewer?.url) URL.revokeObjectURL(documentViewer.url);
    setDocumentViewer(null);
  }

  async function updateKyc(id, status) {
    setUpdatingId(id);
    try {
      let reason = '';
      if (status === 'rejected') {
        reason = window.prompt('Reason for rejecting KYC (optional):', '') || '';
      }
      await apiPatch(`/providers/${id}/kyc`, { status, reason });
      await load();
    } catch (e) {
      alert(status === 'approved' ? `Approval not completed: ${e.message}` : `KYC update failed: ${e.message}`);
    } finally {
      setUpdatingId(null);
    }
  }

  if (loading) return <p>Loading providers...</p>;
  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>;

  const query = search.trim().toLowerCase();
  const visibleProviders = providers.filter((p) => {
    if (!query) return true;
    return [p.generated_id, p.name, p.phone, p.type, p.kyc_status]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const pendingKyc = providers.filter((p) => p.kyc_status === 'pending').length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Providers ({providers.length})</h2>
          <span style={{ color: '#B0A8BE' }}>Pending KYC: {pendingKyc}</span>
        </div>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search phone / provider ID / name" style={{ minWidth: 280 }} />
      </div>
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
          {visibleProviders.map((p) => (
            <tr key={p.id}>
              <td>{p.generated_id}</td>
              <td>{p.name}</td>
              <td>{p.phone}</td>
              <td>{p.type}</td>
              <td>
                <span className={`badge badge-${p.kyc_status}`}>{p.kyc_status}</span>
                {p.kyc_review_note && (
                  <div style={{ marginTop: 6, maxWidth: 260, color: '#E9A3A3', fontSize: 12 }}>
                    {p.kyc_review_note}
                  </div>
                )}
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
                    {p.documents.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className="btn"
                        onClick={() => viewDocument(p.id, d.id, DOC_LABELS[d.doc_type] || d.doc_type)}
                      >
                        {DOC_LABELS[d.doc_type] || d.doc_type}
                      </button>
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
          {visibleProviders.length === 0 && (
            <tr>
              <td colSpan="10">{providers.length === 0 ? 'No providers registered yet.' : 'No provider matches this search.'}</td>
            </tr>
          )}
        </tbody>
      </table>


      {documentLoading && (
        <div className="document-viewer-loading">Opening document…</div>
      )}

      {documentViewer && (
        <div className="document-viewer-backdrop" role="dialog" aria-modal="true" aria-label={documentViewer.label}>
          <div className="document-viewer">
            <div className="document-viewer-head">
              <strong>{documentViewer.label}</strong>
              <button type="button" className="btn btn-light" onClick={closeDocumentViewer}>Close</button>
            </div>
            <div className="document-viewer-body">
              {documentViewer.type.startsWith('image/') ? (
                <img src={documentViewer.url} alt={documentViewer.label} />
              ) : documentViewer.type === 'application/pdf' ? (
                <iframe title={documentViewer.label} src={documentViewer.url} />
              ) : (
                <div className="document-download-fallback">
                  <p>This document type cannot be previewed in the browser.</p>
                  <a href={documentViewer.url} target="_blank" rel="noopener noreferrer">Open document</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
