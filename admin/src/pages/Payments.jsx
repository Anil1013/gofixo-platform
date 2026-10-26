import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet } from '../api';

const STATUS_OPTIONS = [
  { value: 'approved', label: 'Approved / Paid' },
  { value: 'all', label: 'All statuses' },
  { value: 'pending_verification', label: 'Pending verification' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'payout_pending', label: 'Payout pending' },
];

const money = (value) => Number(value || 0).toLocaleString('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2,
});

const dateLabel = (row) => row.occurred_at_ist || (
  row.occurred_at
    ? new Date(row.occurred_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    : '—'
);

const label = (value) => String(value || '—').replaceAll('_', ' ');

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return '"' + text.replaceAll('"', '""') + '"';
}

export default function Payments() {
  const [status, setStatus] = useState('approved');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ status, limit: '2000' });
      if (search.trim()) query.set('search', search.trim());
      const data = await apiGet('/admin/payments/records?' + query.toString());
      setRows(Array.isArray(data.transactions) ? data.transactions : []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message || 'Payment records could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [status, search]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const totals = useMemo(() => {
    const approved = rows.filter((row) => row.status === 'approved');
    const received = approved.filter((row) => row.payment_flow !== 'Gofixo → Recipient');
    const paidOut = approved.filter((row) => row.payment_flow === 'Gofixo → Recipient');
    return {
      count: approved.length,
      received: received.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      paidOut: paidOut.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    };
  }, [rows]);

  function exportCsv() {
    const columns = [
      ['Record ID', 'record_id'], ['Source', 'source'], ['Payment type', 'payment_type'],
      ['Flow', 'payment_flow'], ['Status', 'status'], ['Amount INR', 'amount'],
      ['Customer ID', 'customer_id'], ['Customer name', 'customer_name'], ['Customer phone', 'customer_phone'],
      ['Partner ID', 'provider_code'], ['Partner database ID', 'provider_id'], ['Partner name', 'provider_name'],
      ['Partner phone', 'provider_phone'], ['Professional field', 'professional_field'],
      ['Payment method', 'payment_method'], ['Reference', 'reference'], ['Plan', 'plan_name'],
      ['Cycle start IST', 'cycle_start'], ['Cycle end IST', 'cycle_end'], ['Date IST', 'occurred_at_ist'], ['Notes', 'notes'],
    ];
    const text = [
      columns.map(([heading]) => csvCell(heading)).join(','),
      ...rows.map((row) => columns.map(([, key]) => csvCell(key === 'status' ? label(row[key]) : row[key])).join(',')),
    ].join('\r\n');
    const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gofixo-payment-records-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="payments-page">
      <div className="page-head-row">
        <div>
          <h2>All Payment Records</h2>
          <p className="page-subtitle">Unified ledger from verified wallet top-ups, paid bookings and recorded payment transactions. Times shown in India Standard Time (IST).</p>
        </div>
        <div className="payments-head-actions">
          <button className="btn btn-light" type="button" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
          <button className="btn btn-approve" type="button" onClick={() => load(true)} disabled={loading || refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="payments-summary">
        <article className="payments-stat">
          <span>Approved records in view</span>
          <strong>{totals.count.toLocaleString('en-IN')}</strong>
        </article>
        <article className="payments-stat">
          <span>Customer payments / top-ups</span>
          <strong>{money(totals.received)}</strong>
        </article>
        <article className="payments-stat">
          <span>Recorded payouts</span>
          <strong>{money(totals.paidOut)}</strong>
        </article>
      </div>

      <div className="payments-toolbar">
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="payments-search">
          Search records
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ID, customer, partner, UTR, plan, field…"
            onKeyDown={(event) => { if (event.key === 'Enter') load(); }}
          />
        </label>
        <div className="payments-updated">
          {lastUpdated ? 'Updated ' + lastUpdated.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST · auto-refresh 30s' : 'Auto-refresh every 30 seconds'}
        </div>
      </div>

      {error && <div className="topup-alert topup-alert-error" role="alert">{error}</div>}

      {loading ? (
        <div className="topup-empty">Loading payment records…</div>
      ) : rows.length === 0 ? (
        <div className="topup-empty">No records found for this status/search. Payments appear here automatically when the backend records them.</div>
      ) : (
        <div className="topup-table-wrap">
          <table className="data-table payments-table">
            <thead>
              <tr>
                <th>Record ID / Source</th>
                <th>Date & time (IST)</th>
                <th>Customer</th>
                <th>Partner / professional</th>
                <th>Payment details</th>
                <th>Plan / cycle</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.record_id}>
                  <td>
                    <strong>{row.record_id}</strong>
                    <div className="sub-line">{label(row.source)}</div>
                    <div className="sub-line">{row.payment_type || '—'}</div>
                  </td>
                  <td className="payments-date">{dateLabel(row)}</td>
                  <td>
                    <strong>{row.customer_name || (row.customer_id ? 'Customer #' + row.customer_id : '—')}</strong>
                    <div className="sub-line">{row.customer_id ? 'ID #' + row.customer_id : 'No customer ID'}</div>
                    {row.customer_phone && <div className="sub-line">{row.customer_phone}</div>}
                  </td>
                  <td>
                    <strong>{row.provider_name || (row.provider_id ? 'Partner #' + row.provider_id : '—')}</strong>
                    <div className="sub-line">{row.provider_code || (row.provider_id ? 'Partner ID #' + row.provider_id : 'No partner linked')}</div>
                    {row.provider_phone && <div className="sub-line">{row.provider_phone}</div>}
                    <div className="payments-specialty">{row.professional_field || '—'}</div>
                  </td>
                  <td>
                    <strong className="payments-amount">{money(row.amount)}</strong>
                    <div className="sub-line">{label(row.payment_method)} · {row.payment_flow || '—'}</div>
                    {row.reference && <div className="sub-line payments-reference">Ref: {row.reference}</div>}
                    {row.notes && <div className="sub-line payments-notes">{row.notes}</div>}
                  </td>
                  <td>
                    <strong>{row.plan_name || '—'}</strong>
                    {row.cycle_start && <div className="sub-line">From: {row.cycle_start}</div>}
                    {row.cycle_end && <div className="sub-line">To: {row.cycle_end}</div>}
                    {!row.plan_name && <div className="sub-line">No plan linked to this payment</div>}
                  </td>
                  <td><span className={'badge badge-' + (row.status === 'approved' ? 'approved' : row.status === 'rejected' || row.status === 'failed' ? 'rejected' : 'pending')}>{label(row.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="payments-footnote">This page combines existing payment sources; it does not fabricate missing payments. Cash rides show customer-to-partner settlement, not Gofixo revenue. A plan cycle appears only when it can be linked to an existing payment record.</p>
    </section>
  );
}
