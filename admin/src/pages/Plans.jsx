import { useEffect, useState } from 'react';
import { apiGet } from '../api';

export default function Plans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiGet('/subscriptions/plans')
      .then(setPlans)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading plans...</p>;
  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>;

  return (
    <div>
      <h2>Subscription Plans</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Provider Type</th>
            <th>Plan</th>
            <th>Fee</th>
            <th>Earning Cap</th>
            <th>Validity</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.id}>
              <td>{p.provider_type}</td>
              <td>{p.plan_name}</td>
              <td>₹{p.fee}</td>
              <td>₹{p.earning_cap}</td>
              <td>{p.validity_days} days</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
