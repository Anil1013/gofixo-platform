import { useState } from 'react';
import { apiPost, setSession } from '../api';

const PROVIDER_TYPES = [
  { value: 'bike', label: 'Bike driver' },
  { value: 'car', label: 'Car driver' },
  { value: 'general_worker', label: 'Home helper (cleaning, general)' },
  { value: 'skilled_worker', label: 'Skilled worker (electrician, plumber, carpenter)' },
];

export default function Auth({ onAuthed }) {
  const [role, setRole] = useState('customer'); // customer | provider
  const [mode, setMode] = useState('login'); // login | register | reset
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [providerType, setProviderType] = useState('bike');
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
          await apiPost('/providers/register', { name, phone, type: providerType, password });
        }
        setMode('login');
        setMessage('Account created — please log in.');
      } else if (mode === 'reset') {
        await apiPost(`/auth/${role}/reset-password`, { phone, new_password: password });
        setMode('login');
        setMessage('Password reset — please log in with your new password.');
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
          {mode === 'reset' && 'Reset password'}
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
            <select value={providerType} onChange={(e) => setProviderType(e.target.value)}>
              {PROVIDER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </>
        )}

        <label>Phone number</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="10-digit mobile number"
          inputMode="numeric"
          required
        />

        <label>{mode === 'reset' ? 'New password' : 'Password'}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 4 characters"
          required
        />

        {error && <p className="auth-error">{error}</p>}
        {message && <p className="auth-message">{message}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Please wait...' : mode === 'login' ? 'Log in' : mode === 'register' ? 'Create account' : 'Reset password'}
        </button>

        <div className="auth-links">
          {mode !== 'login' && <button type="button" onClick={() => setMode('login')}>Back to login</button>}
          {mode === 'login' && <button type="button" onClick={() => setMode('register')}>New here? Create account</button>}
          {mode === 'login' && <button type="button" onClick={() => setMode('reset')}>Forgot password?</button>}
        </div>
      </form>
    </div>
  );
}
