import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiUpload } from '../api';

const STATUSES = [
  { value: 'pending_verification', label: 'Needs review' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
];

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
    : '—';
}

function readableStatus(status) {
  return String(status || '').replaceAll('_', ' ');
}

export default function Topups() {
  const [status, setStatus] = useState('pending_verification');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [paymentConfig, setPaymentConfig] = useState({ upi_id: '', payee_name: 'Gofixo', has_qr: false, configured: false });
  const [upiId, setUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('Gofixo');
  const [qrFile, setQrFile] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet('/wallet/admin/topups?status=' + encodeURIComponent(status));
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (err) {
      setError(err.message || 'Could not load wallet top-up requests.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiGet('/wallet/admin/topup-config');
      setPaymentConfig(data);
      setUpiId(data.upi_id || '');
      setPayeeName(data.payee_name || 'Gofixo');
    } catch (err) {
      setError(err.message || 'Could not load UPI payment settings.');
    }
  }, []);

  useEffect(() => { load(); loadConfig(); }, [load, loadConfig]);

  async function saveConfig(event) {
    event.preventDefault();
    if (!upiId.trim() || !payeeName.trim()) {
      setError('UPI ID and payee name are required.');
      return;
    }
    if (!paymentConfig.has_qr && !qrFile) {
      setError('Upload the official Gofixo UPI QR image before saving settings.');
      return;
    }
    setSavingConfig(true);
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.append('upi_id', upiId.trim());
      form.append('payee_name', payeeName.trim());
      if (qrFile) form.append('qr_image', qrFile);
      await apiUpload('/wallet/admin/topup-config', form);
      setQrFile(null);
      setFileInputKey((key) => key + 1);
      setNotice('UPI payment settings saved. Customers can now see the official QR.');
      await loadConfig();
    } catch (err) {
      setError(err.message || 'Could not save UPI payment settings.');
    } finally {
      setSavingConfig(false);
    }
  }

  async function verify(request) {
    const amountText = window.prompt(
      'Confirm the exact amount received in the bank statement for UTR ' + request.utr + '. No wallet credit occurs unless this amount matches.',
      String(request.amount),
    );
    if (amountText === null) return;
    const verifiedAmount = Number(amountText);
    if (!Number.isFinite(verifiedAmount) || verifiedAmount <= 0) {
      setError('Enter a valid bank-confirmed amount.');
      return;
    }
    const bankReference = window.prompt(
      'Enter the bank statement reference / narration ID. Verify the actual bank entry before continuing.',
      request.utr,
    );
    if (bankReference === null) return;
    if (!bankReference.trim()) {
      setError('A bank reference is required.');
      return;
    }
    const note = window.prompt('Optional internal note (leave blank if not needed).', '') ?? '';
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      const result = await apiPost('/wallet/admin/topups/' + request.id + '/verify', {
        verified_amount: verifiedAmount,
        bank_reference: bankReference.trim(),
        note: note.trim(),
      });
      setNotice('Verified and credited ' + money(result.credited_amount) + ' to customer #' + request.customer_id + '.');
      await load();
    } catch (err) {
      setError(err.message || 'Verification failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(request) {
    const note = window.prompt('Enter the reason this payment claim is being rejected.');
    if (note === null) return;
    if (!note.trim()) {
      setError('A rejection reason is required.');
      return;
    }
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      await apiPost('/wallet/admin/topups/' + request.id + '/reject', { note: note.trim() });
      setNotice('Payment claim #' + request.id + ' rejected. No wallet credit was made.');
      await load();
    } catch (err) {
      setError(err.message || 'Could not reject the payment claim.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <div className="page-head-row">
        <div>
          <h2>UPI Wallet Top-ups</h2>
          <p className="page-subtitle">Match each customer UTR against the actual bank record before crediting their wallet.</p>
        </div>
        <button className="btn btn-approve" type="button" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="topup-config-card">
        <div>
          <h3>Customer payment QR settings</h3>
          <p className="page-subtitle">Store the official QR securely in the backend database. It is sent only to signed-in customers, not published as a repository asset.</p>
        </div>
        <div className={paymentConfig.configured ? 'topup-config-status is-ready' : 'topup-config-status'}>
          {paymentConfig.configured ? 'QR configured' : 'Setup required'}
          {paymentConfig.updated_at_ist && <span>Updated {paymentConfig.updated_at_ist} IST</span>}
        </div>
        <form className="topup-config-form" onSubmit={saveConfig}>
          <label>
            Official UPI ID
            <input value={upiId} onChange={(event) => setUpiId(event.target.value)} placeholder="name@bank" autoComplete="off" required />
          </label>
          <label>
            Payee name
            <input value={payeeName} onChange={(event) => setPayeeName(event.target.value)} placeholder="Gofixo" maxLength={120} required />
          </label>
          <label>
            QR image {paymentConfig.has_qr ? '(optional — choose only to replace)' : '(required)'}
            <input key={fileInputKey} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setQrFile(event.target.files?.[0] || null)} required={!paymentConfig.has_qr} />
            <span className="sub-line">PNG, JPG or WebP · maximum 1 MB</span>
          </label>
          {qrFile && <span className="sub-line">Selected: {qrFile.name}</span>}
          <button className="btn btn-approve" type="submit" disabled={savingConfig}>
            {savingConfig ? 'Saving settings…' : 'Save payment settings'}
          </button>
        </form>
      </div>

      <div className="topup-safety-note">
        <strong>Bank verification required</strong>
        <span>Customer-submitted UTRs and QR screenshots are claims, not proof of receipt. Verify the bank transaction and exact amount. Each request can be processed once.</span>
      </div>

      <div className="topup-toolbar">
        <label htmlFor="topup-status">Request status</label>
        <select id="topup-status" value={status} onChange={(event) => setStatus(event.target.value)}>
          {STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <span className="topup-count">{requests.length} request{requests.length === 1 ? '' : 's'}</span>
      </div>

      {error && <div className="topup-alert topup-alert-error" role="alert">{error}</div>}
      {notice && <div className="topup-alert topup-alert-success" role="status">{notice}</div>}

      {loading ? (
        <div className="topup-empty">Loading wallet top-up requests…</div>
      ) : requests.length === 0 ? (
        <div className="topup-empty">No {readableStatus(status)} requests found.</div>
      ) : (
        <div className="topup-table-wrap">
          <table className="data-table topup-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Amount</th>
                <th>UTR / bank reference</th>
                <th>Submitted (IST)</th>
                <th>Status</th>
                <th>Admin action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>
                    <strong>{request.customer_name || ('Customer #' + request.customer_id)}</strong>
                    <div className="sub-line">ID #{request.customer_id}{request.phone ? ' · ' + request.phone : ''}</div>
                    <div className="sub-line">Request #{request.id}</div>
                  </td>
                  <td><strong>{money(request.amount)}</strong></td>
                  <td>
                    <code>{request.utr}</code>
                    {request.bank_reference && <div className="sub-line">Bank: {request.bank_reference}</div>}
                    {request.admin_note && <div className="sub-line">Note: {request.admin_note}</div>}
                  </td>
                  <td>{request.created_at_ist || (request.created_at ? new Date(request.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—')}</td>
                  <td><span className={'badge badge-' + (request.status === 'verified' ? 'approved' : request.status === 'rejected' ? 'rejected' : 'pending')}>{readableStatus(request.status)}</span></td>
                  <td>
                    {request.status === 'pending_verification' ? (
                      <>
                        <button className="btn btn-approve" type="button" disabled={busyId === request.id} onClick={() => verify(request)}>
                          {busyId === request.id ? 'Working…' : 'Verify & credit'}
                        </button>
                        <button className="btn btn-reject" type="button" disabled={busyId === request.id} onClick={() => reject(request)}>
                          Reject
                        </button>
                      </>
                    ) : <span className="sub-line">{request.verified_at_ist || 'Processed'}</span>}
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
