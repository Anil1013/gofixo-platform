import { useEffect, useState } from 'react';
import { API_BASE, apiUpload, getToken } from '../api';

export default function ProfilePhoto({ role, userId, size = 'large', onChanged, fallbackImage = '', editable = true }) {
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadPhoto() {
    setError('');
    const path = role === 'provider'
      ? `/providers/${userId}/profile-photo`
      : '/auth/customer/profile-photo';

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        if (res.status !== 404) throw new Error('Could not load profile photo');
        setSrc('');
        return;
      }
      const blob = await res.blob();
      const nextUrl = URL.createObjectURL(blob);
      setSrc((old) => {
        if (old) URL.revokeObjectURL(old);
        return nextUrl;
      });
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadPhoto();
    return () => {
      setSrc((old) => {
        if (old) URL.revokeObjectURL(old);
        return '';
      });
    };
  }, [role, userId]);

  async function changePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Please choose a JPG, PNG, or WEBP photo.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('Photo must be 8 MB or smaller.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);

      if (role === 'provider') {
        form.append('doc_type', 'profile_photo');
        await apiUpload(`/providers/${userId}/documents`, form, true);
      } else {
        await apiUpload('/auth/customer/profile-photo', form, true);
      }

      await loadPhoto();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`profile-photo-editor ${size}`}>
      <div className="profile-photo-frame">
        {src ? (
          <img src={src} alt="Profile" />
        ) : fallbackImage ? (
          <img src={fallbackImage} alt="Profile" />
        ) : (
          <span>{role === 'provider' ? 'P' : 'C'}</span>
        )}
        {editable && <label className="profile-photo-camera" title="Change profile photo">
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={changePhoto} disabled={busy} />
          {busy ? '…' : '✎'}
        </label>}
      </div>
      {editable && <label className="profile-photo-change">
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={changePhoto} disabled={busy} />
        {busy ? 'Uploading…' : 'Change photo'}
      </label>}
      {editable && error && <small className="profile-photo-error">{error}</small>}
    </div>
  );
}
