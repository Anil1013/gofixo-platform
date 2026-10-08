import { useState } from 'react';
import { apiPost, setSession } from '../api';

const HOME_SERVICE_SPECIALTIES = [
  ['electrician', 'Electrician'],
  ['plumber', 'Plumber'],
  ['ac_service', 'AC Service'],
  ['cleaning', 'Cleaning'],
  ['painter', 'Painter'],
  ['carpenter', 'Carpenter'],
  ['appliance_repair', 'Appliance Repair'],
  ['pest_control', 'Pest Control'],
  ['packers_movers', 'Packers & Movers'],
  ['salon_beauty', 'Salon & Beauty'],
];

const PROVIDER_TYPES = [
  { value: 'bike', label: 'Bike driver' },
  { value: 'auto', label: 'Auto driver' },
  { value: 'car', label: 'Car driver' },
  { value: 'general_worker', label: 'Home helper (cleaning, general)' },
  { value: 'skilled_worker', label: 'Skilled worker (electrician, plumber, carpenter)' },
];

export default function Auth({ onAuthed }) {
  const [role, setRole] = useState('customer'); // customer | provider
  const [mode, setMode] = useState('login'); // login | register | forgot
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [providerType, setProviderType] = useState('bike');
  const [serviceCategories, setServiceCategories] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      if (mode === 'register') {
        if (role === 'customer') {
          await apiPost('/auth/customer/register', { name, phone, password });
        } else {
          await apiPost('/providers/register', {
            name,
            phone,
            type: providerType,
            password,
            service_categories: ['general_worker', 'skilled_worker'].includes(providerType) ? serviceCategories : [],
          });
        }
        setMode('login');
        setMessage('Account created — please log in.');
      } else if (mode === 'forgot') {
        await apiPost(`/auth/${role}/forgot-password`, { phone });
        setMode('login');
        setMessage('Reset request submitted. An administrator can complete the password reset for this account.');
      } else {
        const data = await apiPost(`/auth/${role}/login`, { phone, password });
        setSession(data.token, data.user, role);
        onAuthed(data.user, role);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <h1>Gofixo</h1>
        <p>Rides and home services</p>
      </div>

      <div className="role-switch">
        <button className={role === 'customer' ? 'active' : ''} onClick={() => { setRole('customer'); setError(''); }}>
          I need a service
        </button>
        <button className={role === 'provider' ? 'active' : ''} onClick={() => { setRole('provider'); setError(''); }}>
          I'm a driver / worker
        </button>
      </div>

      <form className="auth-box" onSubmit={submit}>
        <h2>
          {mode === 'login' && 'Log in'}
          {mode === 'register' && (role === 'customer' ? 'Create customer account' : 'Register as a provider')}
          {mode === 'forgot' && 'Forgot password'}
        </h2>

        {mode === 'register' && (
          <>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
          </>
        )}

        {mode === 'register' && role === 'provider' && (
          <>
            <label>What do you do?</label>
            <select value={providerType} onChange={(e) => { setProviderType(e.target.value); if (['bike', 'auto', 'car'].includes(e.target.value)) setServiceCategories([]); }}>
              {PROVIDER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            {['general_worker', 'skilled_worker'].includes(providerType) && (
              <>
                <label>Home-service specialties</label>
                <div className="service-specialty-grid">
                  {HOME_SERVICE_SPECIALTIES.map(([value, label]) => (
                    <label key={value} className="service-specialty-option">
                      <input
                        type="checkbox"
                        checked={serviceCategories.includes(value)}
                        onChange={(e) => setServiceCategories((current) => (
                          e.target.checked
                            ? [...current, value]
                            : current.filter((item) => item !== value)
                        ))}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <small className="auth-help">Select the services you are qualified to accept. You can add more later from your partner profile.</small>
              </>
            )}
          </>
        )}

        <label>Phone number</label>
        <div className="phone-input">
          <span className="phone-prefix">+91</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="10-digit mobile number"
            inputMode="numeric"
            required
          />
        </div>

        {mode !== 'forgot' && (
          <>
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 chars, letters + numbers"
              required
            />
          </>
        )}

        {mode === 'forgot' && (
          <p className="auth-reset-help">
            Enter your registered phone number. Your password will not be changed immediately;
            a reset request is created for admin approval.
          </p>
        )}

        {error && <p className="auth-error">{error}</p>}
        {message && <p className="auth-message">{message}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Please wait...' : mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : 'Request reset'}
        </button>

        <div className="auth-links">
          {mode !== 'login' && <button type="button" onClick={() => { setMode('login'); setError(''); setMessage(''); }}>Back to login</button>}
          {mode === 'login' && <button type="button" onClick={() => setMode('register')}>New here? Create account</button>}
          {mode === 'login' && role === 'customer' && <button type="button" onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}>Forgot password?</button>}
        </div>
      </form>
    </div>
  );
}
