import { useEffect, useState } from 'react';
import { apiGet, apiGetBlob, apiPatch, apiPost } from '../api';


function ProviderPhoto({ providerId, documentId, size = 44 }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!documentId) return undefined;
    let active = true;
    let url = '';
    apiGetBlob(`/providers/admin/${providerId}/documents/${documentId}`)
      .then((blob) => { if (active) { url = URL.createObjectURL(blob); setSrc(url); } })
      .catch(() => {});
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [providerId, documentId]);
  return src
    ? <img src={src} alt="Provider profile" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
    : <div style={{ width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#EAFBF2', color: '#16A34A', fontWeight: 800 }}>👤</div>;
}

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
  const [updatingSkill, setUpdatingSkill] = useState('');
  const [search, setSearch] = useState('');
  const [documentViewer, setDocumentViewer] = useState(null);
  const [documentLoading, setDocumentLoading] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
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

  async function resetProviderPassword(provider) {
    const newPassword = window.prompt('Set a temporary password for ' + provider.name + '. Share it with the partner securely:');
    if (newPassword === null) return;
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(newPassword)) {
      alert('Password must be at least 8 characters and include letters and numbers.');
      return;
    }
    setUpdatingId(provider.id);
    try {
      await apiPost(`/providers/${provider.id}/reset-password`, { new_password: newPassword });
      alert('Partner password reset. The partner must sign in again with the new password.');
      await load();
    } catch (e) {
      alert('Partner password reset failed: ' + e.message);
    } finally {
      setUpdatingId(null);
    }
  }

  async function updateSkillKyc(providerId, skillKey, status) {
    const key = `${providerId}:${skillKey}`;
    setUpdatingSkill(key);
    try {
      let reason = '';
      if (status === 'rejected') reason = window.prompt('Reason for rejecting this skill (optional):', '') || '';
      await apiPatch(`/providers/${providerId}/skills/${encodeURIComponent(skillKey)}/kyc`, { status, reason });
      await load();
    } catch (e) {
      alert(`Skill review failed: ${e.message}`);
    } finally {
      setUpdatingSkill('');
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search phone / partner ID / name" style={{ minWidth: 240 }} />
          <button type="button" className="btn btn-light" onClick={load} disabled={loading || updatingId !== null || !!updatingSkill}>{loading ? 'Refreshing…' : 'Refresh partners'}</button>
        </div>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Sr. No.</th>
            <th>Photo</th>
            <th>ID</th>
            <th>Name</th>
            <th>Phone</th>
            <th>Type</th>
            <th>Specialties</th>
            <th>KYC</th>
            <th>Plan</th>
            <th>Pending</th>
            <th>Documents</th>
            <th>Rating</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibleProviders.map((p, index) => (
            <tr key={p.id}>
              <td>{index + 1}</td>
              <td><ProviderPhoto providerId={p.id} documentId={p.documents?.find((d) => d.doc_type === 'profile_photo')?.id} /></td>
              <td>{p.generated_id}</td>
              <td>{p.name}</td>
              <td>{p.phone}</td>
              <td>{p.type}</td>
              <td>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {(Array.isArray(p.skills) ? p.skills : []).map((skill) => (
                    <div key={skill.skill_key} style={{ border: '1px solid #334155', borderRadius: 8, padding: '5px 7px', minWidth: 110 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{String(skill.skill_key).replaceAll('_', ' ')}</div>
                      <div style={{ fontSize: 11, margin: '3px 0', color: skill.kyc_status === 'approved' ? '#22C55E' : skill.kyc_status === 'rejected' ? '#F87171' : '#FBBF24' }}>
                        {skill.service_type} · {skill.kyc_status}
                      </div>
                      {skill.review_note && <div style={{ fontSize: 10, maxWidth: 150 }}>{skill.review_note}</div>}
                      {skill.kyc_status !== 'approved' && (
                        <button type="button" className="btn btn-approve" disabled={updatingSkill === `${p.id}:${skill.skill_key}`} onClick={() => updateSkillKyc(p.id, skill.skill_key, 'approved')}>Approve skill</button>
                      )}
                      {skill.kyc_status !== 'rejected' && (
                        <button type="button" className="btn btn-reject" disabled={updatingSkill === `${p.id}:${skill.skill_key}`} onClick={() => updateSkillKyc(p.id, skill.skill_key, 'rejected')}>Reject skill</button>
                      )}
                      <div style={{ fontSize: 10, color: '#B0A8BE' }}>{skill.is_available ? 'Skill online' : 'Skill offline'}</div>
                    </div>
                  ))}
                  {(!p.skills || p.skills.length === 0) && <span style={{ color: '#B0A8BE' }}>No skills</span>}
                </div>
              </td>
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
                        onClick={() => viewDocument(p.id, d.id, `${DOC_LABELS[d.doc_type] || d.doc_type}${d.skill_key ? ` · ${d.skill_key.replaceAll('_', ' ')}` : ' · Account'}`)}
                      >
                        {DOC_LABELS[d.doc_type] || d.doc_type}{d.skill_key ? ` · ${d.skill_key.replaceAll('_', ' ')}` : ' · Account'}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span style={{ color: '#B0A8BE' }}>none uploaded</span>
                )}
              </td>
              <td>{p.avg_rating} ★</td>
              <td>
                {p.reset_requested && (
                  <button
                    className="btn"
                    disabled={updatingId === p.id}
                    onClick={() => resetProviderPassword(p)}
                  >
                    Reset password
                  </button>
                )}
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
              <td colSpan="13">{providers.length === 0 ? 'No providers registered yet.' : 'No provider matches this search.'}</td>
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
