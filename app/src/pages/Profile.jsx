import ProfilePhoto from '../components/ProfilePhoto';
import { getRole, getUser } from '../api';

const TYPE_LABELS = {
  bike: 'Bike driver',
  auto: 'Auto driver',
  car: 'Car driver',
  general_worker: 'Home services',
  skilled_worker: 'Skilled professional',
};

export default function Profile({ onLogout, onOpenKyc }) {
  const role = getRole();
  const user = getUser() || {};
  const isProvider = role === 'provider';

  return (
    <div className="profile-screen">
      <div className="profile-page-head">
        <span className="section-kicker">GOFIXO ACCOUNT</span>
        <h1>My Profile</h1>
        <p>Manage your photo and account access.</p>
      </div>

      <section className="profile-card">
        <ProfilePhoto role={role} userId={user.id} size="large" />
        <div className="profile-identity">
          <h2>{user.name || 'Gofixo User'}</h2>
          <p>{user.phone || 'Phone not available'}</p>
          {isProvider && <span className="profile-role-badge">{TYPE_LABELS[user.type] || 'Service provider'}</span>}
          {!isProvider && <span className="profile-role-badge customer">Customer</span>}
        </div>
      </section>

      <section className="profile-info-grid">
        <div><small>ACCOUNT</small><strong>{isProvider ? 'Service Provider' : 'Customer'}</strong></div>
        {isProvider && <div><small>PARTNER ID</small><strong>{user.generated_id || '—'}</strong></div>}
        <div><small>PHONE</small><strong>{user.phone || '—'}</strong></div>
      </section>

      <section className="profile-photo-help">
        <strong>Use a clear real photo</strong>
        <p>Your profile photo helps customers or partners recognise who they are meeting.</p>
      </section>

      {isProvider && onOpenKyc && (
        <button type="button" className="profile-secondary-cta" onClick={onOpenKyc}>
          KYC & documents →
        </button>
      )}

      <button type="button" className="profile-logout-cta" onClick={onLogout}>
        Log out
      </button>
    </div>
  );
}
