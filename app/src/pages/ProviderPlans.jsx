import { useEffect, useState } from 'react';
import { apiGet, apiPost, getUser } from '../api';

export default function ProviderPlans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const user = getUser();

  useEffect(() => {
    apiGet(`/providers/plans/${user.type}`)
      .then(setPlans)
      .finally(() => setLoading(false));
  }, []);

  async function subscribe(planId) {
    setBusyId(planId);
    setError('');
    setMessage('');
    try {
      await apiPost('/subscriptions/subscribe', { plan_id: planId }, true);
      setMessage('Subscribed! Go to Dashboard to go available.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="screen"><p>Loading plans...</p></div>;

  return (
    <div className="screen">
      <h2>Subscription plans</h2>
      {error && <p className="auth-error">{error}</p>}
      {message && <p className="auth-message">{message}</p>}
      {plans.map((p) => (
        <div key={p.id} className="history-item" style={{ alignItems: 'center' }}>
          <div>
            <p className="history-title">{p.plan_name} — ₹{p.fee}</p>
            <p className="history-sub">Earn up to ₹{Number(p.earning_cap).toLocaleString('en-IN')} · {p.validity_days} days</p>
          </div>
          <button className="secondary" style={{ width: 'auto', margin: 0, padding: '8px 14px' }} onClick={() => subscribe(p.id)} disabled={busyId === p.id}>
            {busyId === p.id ? '...' : 'Subscribe'}
          </button>
        </div>
      ))}
    </div>
  );
}
