import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch } from '../api';

const money = (value) => Number(value || 0).toLocaleString('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2,
});

const label = (value) => String(value || '—').replaceAll('_', ' ');

export default function Payouts() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet('/admin/payouts?limit=250' + (status === 'all' ? '' : '&status=' + encodeURIComponent(status)));
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Partner payouts could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function updatePayout(row, nextStatus) {
    let body = { status: nextStatus };
    if (nextStatus === 'paid') {
      const reference = window.prompt(
        'Enter the bank/UPI transfer reference for ' + money(row.payout_amount) +
        '. Only mark paid after the transfer is confirmed in your bank account.'
      );
      if (!reference || !reference.trim()) return;
      body.provider_reference = reference.trim();
    } else if (nextStatus === 'failed') {
      const reason = window.prompt('Why did this payout fail?');
      if (!reason || !reason.trim()) return;
      body.failure_reason = reason.trim();
    }
    setBusyId(row.id);
    setError('');
    setNotice('');
    try {
      await apiPatch('/admin/payouts/' + row.id + '/status', body);
      setNotice('Payout #' + row.id + ' updated to ' + label(nextStatus) + '.');
      await load();
    } catch (err) {
      setError(err.message || 'Payout status could not be updated.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="payments-page">
      <div className="page-head-row">
        <div>
          <h2>Partner payouts</h2>
          <p className="page-subtitle">
            Review completed home-service earnings and record manual bank/UPI settlements. Transfer money outside Gofixo first; mark it paid only after confirming the bank entry.
          </p>
        </div>
        <div className="payments-head-actions">
          <button className="btn btn-approve" type="button" onClick={load} disabled={loading || busyId !== null}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="payments-toolbar">
        <label>
          Payout status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="all">All statuses</option>
          </select>
        </label>
        <div className="payments-updated">Showing up to 250 records</div>
      </div>

      {error && <div className="topup-alert topup-alert-error" role="alert">{error}</div>}
      {notice && <div className="topup-alert topup-alert-success" role="status">{notice}</div>}

      {loading ? (
        <div className="topup-empty">Loading partner payouts…</div>
      ) : rows.length === 0 ? (
        <div className="topup-empty">No partner payouts found for this status.</div>
      ) : (
        <div className="topup-table-wrap">
          <table className="data-table payments-table">
            <thead>
              <tr>
                <th>Payout / booking</th>
                <th>Partner</th>
                <th>Gross</th>
                <th>Platform fee</th>
                <th>Partner amount</th>
                <th>Transfer reference / reason</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>Payout #{row.id}</strong>
                    <div className="sub-line">Booking #{row.booking_id}</div>
                    <div className="sub-line">{row.created_at ? new Date(row.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : '—'}</div>
                  </td>
                  <td>
                    <strong>{row.provider_name || 'Partner #' + row.provider_id}</strong>
                    <div className="sub-line">{row.generated_id || 'Partner ID unavailable'}</div>
                  </td>
                  <td>{money(row.gross_amount)}</td>
                  <td>{money(row.platform_fee)}</td>
                  <td><strong className="payments-amount">{money(row.payout_amount)}</strong></td>
                  <td>
                    {row.provider_reference && <div>Ref: {row.provider_reference}</div>}
                    {row.failure_reason && <div className="sub-line">{row.failure_reason}</div>}
                    {!row.provider_reference && !row.failure_reason && '—'}
                    {row.paid_at && <div className="sub-line">Paid: {new Date(row.paid_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</div>}
                  </td>
                  <td><span className={'badge badge-' + (row.payout_status === 'paid' ? 'approved' : row.payout_status === 'failed' ? 'rejected' : 'pending')}>{label(row.payout_status)}</span></td>
                  <td>
                    {row.payout_status !== 'paid' && (
                      <div className="payments-head-actions">
                        {row.payout_status !== 'processing' && (
                          <button className="btn btn-light" type="button" disabled={busyId !== null} onClick={() => updatePayout(row, 'processing')}>
                            Processing
                          </button>
                        )}
                        <button className="btn btn-approve" type="button" disabled={busyId !== null} onClick={() => updatePayout(row, 'paid')}>
                          {busyId === row.id ? 'Saving…' : 'Mark paid'}
                        </button>
                        <button className="btn btn-light" type="button" disabled={busyId !== null} onClick={() => updatePayout(row, 'failed')}>
                          Failed
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
