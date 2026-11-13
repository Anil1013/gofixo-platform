import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';

const money = (v) => Number(v || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const label = (v) => String(v || '—').replaceAll('_', ' ');

export default function SubscriptionPayments() {
  const [status, setStatus] = useState('pending_verification');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await apiGet('/subscriptions/admin/payment-requests?status=' + encodeURIComponent(status));
      setRows(Array.isArray(data.requests) ? data.requests : []);
    } catch (e) { setError(e.message || 'Could not load subscription payment requests.'); }
    finally { setLoading(false); }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function verify(row) {
    const amountText = window.prompt('Confirm exact amount received in bank statement for UTR ' + row.utr + '.', String(row.amount));
    if (amountText === null) return;
    const bankReference = window.prompt('Enter the bank statement reference / narration ID after checking actual credit.', row.utr);
    if (bankReference === null || !bankReference.trim()) return;
    const note = window.prompt('Optional internal note.', '') ?? '';
    setBusyId(row.id); setError(''); setNotice('');
    try {
      await apiPost('/subscriptions/admin/payment-requests/' + row.id + '/verify', {
        verified_amount: Number(amountText), bank_reference: bankReference.trim(), note: note.trim(),
      });
      setNotice('Payment verified and subscription activated for ' + (row.provider_name || 'partner') + '.');
      await load();
    } catch (e) { setError(e.message || 'Verification failed.'); }
    finally { setBusyId(null); }
  }

  async function reject(row) {
    const note = window.prompt('Enter a clear reason for rejecting this payment claim.');
    if (note === null || !note.trim()) return;
    setBusyId(row.id); setError(''); setNotice('');
    try {
      await apiPost('/subscriptions/admin/payment-requests/' + row.id + '/reject', { note: note.trim() });
      setNotice('Payment claim rejected. No subscription was activated.');
      await load();
    } catch (e) { setError(e.message || 'Could not reject request.'); }
    finally { setBusyId(null); }
  }

  return (
    <section>
      <div className="page-head-row">
        <div>
          <h2>Ride Subscription Payments</h2>
          <p className="page-subtitle">Verify the actual bank credit and exact plan fee before activating a partner subscription. A submitted UTR alone is not proof of payment.</p>
        </div>
        <button className="btn btn-approve" type="button" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <div className="topup-safety-note">
        <strong>Manual bank verification required</strong>
        <span>Only approve after matching the amount and bank reference in Gofixo’s bank statement. Approval atomically creates the subscription; duplicate approval is blocked.</span>
      </div>
      <div className="topup-toolbar">
        <label htmlFor="subscription-payment-status">Request status</label>
        <select id="subscription-payment-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending_verification">Needs review</option>
          <option value="verified">Verified / activated</option>
          <option value="rejected">Rejected</option>
        </select>
        <span className="topup-count">{rows.length} request{rows.length === 1 ? '' : 's'}</span>
      </div>
      {error && <div className="topup-alert topup-alert-error" role="alert">{error}</div>}
      {notice && <div className="topup-alert topup-alert-success" role="status">{notice}</div>}
      {loading ? <div className="topup-empty">Loading subscription payment claims…</div> : rows.length === 0 ? (
        <div className="topup-empty">No {label(status)} subscription requests.</div>
      ) : (
        <div className="topup-table-wrap">
          <table className="data-table topup-table">
            <thead><tr><th>Sr. No.</th><th>Partner</th><th>Plan</th><th>Amount</th><th>UTR / bank ref</th><th>Submitted</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{rows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td><strong>{row.provider_name || 'Partner #' + row.provider_id}</strong><div className="sub-line">ID #{row.provider_id} · {row.provider_phone || row.generated_id || ''}</div></td>
                <td><strong>{row.plan_name}</strong><div className="sub-line">{row.validity_days} days · earning cap {money(row.earning_cap)}</div></td>
                <td><strong>{money(row.amount)}</strong></td>
                <td><code>{row.utr}</code>{row.bank_reference && <div className="sub-line">Bank: {row.bank_reference}</div>}{row.admin_note && <div className="sub-line">{row.admin_note}</div>}</td>
                <td>{row.created_at ? new Date(row.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : '—'}</td>
                <td><span className={'badge badge-' + (row.status === 'verified' ? 'approved' : row.status === 'rejected' ? 'rejected' : 'pending')}>{label(row.status)}</span></td>
                <td>{row.status === 'pending_verification' ? <><button className="btn btn-approve" type="button" disabled={busyId === row.id} onClick={() => verify(row)}>{busyId === row.id ? 'Working…' : 'Verify & activate'}</button><button className="btn btn-reject" type="button" disabled={busyId === row.id} onClick={() => reject(row)}>Reject</button></> : <span className="sub-line">{row.verified_at ? new Date(row.verified_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'Processed'}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
