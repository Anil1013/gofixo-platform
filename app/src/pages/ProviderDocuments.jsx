import { useEffect, useState } from 'react';
import { API_BASE, apiGet, apiUpload, getToken, getUser } from '../api';

const RIDE_DOCS = [
  { value: 'aadhar_front', label: 'Aadhar card (front)' },
  { value: 'aadhar_back', label: 'Aadhar card (back)' },
  { value: 'driving_license', label: 'Driving license' },
  { value: 'vehicle_rc', label: 'Vehicle RC' },
  { value: 'vehicle_photo_front', label: 'Vehicle photo (front)' },
  { value: 'vehicle_photo_back', label: 'Vehicle photo (back)' },
];

const WORKER_DOCS = [
  { value: 'aadhar_front', label: 'Aadhar card (front)' },
  { value: 'aadhar_back', label: 'Aadhar card (back)' },
  { value: 'profile_photo', label: 'Profile photo' },
  { value: 'police_verification', label: 'Police verification' },
];

export default function ProviderDocuments() {
  const user = getUser();
  const isRide = ['bike', 'car', 'auto'].includes(user.type);
  const docTypes = isRide ? RIDE_DOCS : WORKER_DOCS;
  const optionalDocs = [{ value: 'profile_photo', label: 'Profile photo (optional)' }];

  const [docType, setDocType] = useState(docTypes[0].value);
  const [file, setFile] = useState(null);
  const [uploaded, setUploaded] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [kycStatus, setKycStatus] = useState('pending');
  const [reviewNote, setReviewNote] = useState('');

  async function load() {
    const me = await apiGet('/providers/me', true);
    setUploaded(me.documents || []);
    setKycStatus(me.kyc_status || 'pending');
    setReviewNote(me.kyc_review_note || '');
  }

  useEffect(() => { load(); }, []);

  async function upload() {
    if (!file) return;

    const maxBytes = 15 * 1024 * 1024;
    const extension = (file.name || '').toLowerCase().match(/\\.[^.]+$/)?.[0] || '';
    const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/octet-stream', '']);
    if (file.size > maxBytes) {
      setError('File is too large. Maximum size is 15 MB.');
      return;
    }
    if (!allowedExtensions.has(extension) || !allowedTypes.has(file.type)) {
      setError('Please select a valid JPG, PNG, WEBP, or PDF file.');
      return;
    }

    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('doc_type', docType);
      formData.append('file', file);
      await apiUpload(`/providers/${user.id}/documents`, formData);
      setFile(null);
      load();
    } catch (err) {
      setError(err.message || 'Profile upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function openDocument(documentId) {
    setError('');
    try {
      const res = await fetch(`${API_BASE}/providers/${user.id}/documents/${documentId}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Unable to open document');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
    } catch (err) {
      setError(err.message);
    }
  }

  const uploadedTypes = new Set(uploaded.map((d) => d.doc_type));
  const requiredRemaining = docTypes.filter((d) => !uploadedTypes.has(d.value));
  const allDone = requiredRemaining.length === 0;
  const selectableDocs = isRide ? [...docTypes, ...optionalDocs] : docTypes;

  return (
    <div className="screen">
      <h2>KYC documents</h2>

      {reviewNote && (
        <div className="auth-error" style={{ marginBottom: 16 }}>
          <strong>KYC update:</strong>
          <p style={{ margin: '6px 0 0' }}>{reviewNote}</p>
          {kycStatus !== 'approved' && (
            <p style={{ margin: '8px 0 0' }}>Please correct the document issue below and upload the required document(s).</p>
          )}
        </div>
      )}

      {kycStatus === 'approved' && !reviewNote && (
        <div className="kyc-progress done">
          <p className="kyc-progress-label">✅ KYC approved</p>
        </div>
      )}

      <div className={allDone ? 'kyc-progress done' : 'kyc-progress'}>
        <p className="kyc-progress-label">
          {allDone ? '✅ All required documents uploaded' : `${uploadedTypes.size} of ${docTypes.length} required documents uploaded`}
        </p>
        <div className="kyc-checklist">
          {docTypes.map((d) => (
            <div key={d.value} className={uploadedTypes.has(d.value) ? 'kyc-check-item done' : 'kyc-check-item'}>
              <span>{uploadedTypes.has(d.value) ? '✓' : '○'}</span> {d.label}
            </div>
          ))}
        </div>
        {isRide && (
          <p style={{ marginTop: 10, color: 'var(--text-dim)', fontSize: 13 }}>
            Profile photo is optional and can be replaced anytime without changing KYC approval.
          </p>
        )}
      </div>

      <label>Document type</label>
      <select value={docType} onChange={(e) => setDocType(e.target.value)}>
        {selectableDocs.map((d) => (
          <option key={d.value} value={d.value}>{d.label}{uploadedTypes.has(d.value) ? ' ✓ — replace if needed' : ''}</option>
        ))}
      </select>

      <label>Upload file</label>
      <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files[0])} />

      {error && <p className="auth-error">{error}</p>}

      <button className="cta" onClick={upload} disabled={!file || uploading}>
        {uploading ? 'Uploading...' : 'Upload'}
      </button>

      <h2 style={{ marginTop: 28 }}>Uploaded so far</h2>
      {uploaded.length === 0 && <p style={{ color: 'var(--text-dim)' }}>No documents uploaded yet.</p>}
      {uploaded.map((d, i) => (
        <div key={d.id || i} className="history-item">
          <p className="history-title">{selectableDocs.find((t) => t.value === d.doc_type)?.label || d.doc_type}</p>
          {d.id && <button type="button" onClick={() => openDocument(d.id)} style={{ width: 'auto', margin: 0, padding: '6px 10px' }}>View</button>}
        </div>
      ))}
    </div>
  );
}
