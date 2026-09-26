import { useEffect, useState } from 'react';
import { apiGet, apiUpload, getUser } from '../api';

const RIDE_DOCS = [
  { value: 'aadhar', label: 'Aadhar card' },
  { value: 'driving_license', label: 'Driving license' },
  { value: 'vehicle_rc', label: 'Vehicle RC' },
  { value: 'vehicle_photo', label: 'Vehicle photo' },
  { value: 'profile_photo', label: 'Profile photo' },
];

const WORKER_DOCS = [
  { value: 'aadhar', label: 'Aadhar card' },
  { value: 'profile_photo', label: 'Profile photo' },
  { value: 'police_verification', label: 'Police verification' },
];

export default function ProviderDocuments() {
  const user = getUser();
  const isRide = user.type === 'bike' || user.type === 'car';
  const docTypes = isRide ? RIDE_DOCS : WORKER_DOCS;

  const [docType, setDocType] = useState(docTypes[0].value);
  const [file, setFile] = useState(null);
  const [uploaded, setUploaded] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const me = await apiGet('/providers/me', true);
    setUploaded(me.documents || []);
  }

  useEffect(() => { load(); }, []);

  async function upload() {
    if (!file) return;
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
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="screen">
      <h2>KYC documents</h2>

      <label>Document type</label>
      <select value={docType} onChange={(e) => setDocType(e.target.value)}>
        {docTypes.map((d) => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </select>

      <label>Upload file</label>
      <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0])} />

      {error && <p className="auth-error">{error}</p>}

      <button className="cta" onClick={upload} disabled={!file || uploading}>
        {uploading ? 'Uploading...' : 'Upload'}
      </button>

      <h2 style={{ marginTop: 28 }}>Uploaded so far</h2>
      {uploaded.length === 0 && <p style={{ color: 'var(--text-dim)' }}>No documents uploaded yet.</p>}
      {uploaded.map((d, i) => (
        <div key={i} className="history-item">
          <p className="history-title">{docTypes.find((t) => t.value === d.doc_type)?.label || d.doc_type}</p>
          <a href={`https://gofixo.mob13r.com${d.file_url}`} target="_blank" rel="noreferrer" style={{ color: 'var(--violet)', fontSize: 13 }}>View</a>
        </div>
      ))}
    </div>
  );
}
