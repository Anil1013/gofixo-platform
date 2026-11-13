import { useEffect, useMemo, useState } from 'react';
import { apiDelete, apiGet, apiPut } from '../api';

const empty = { label: '', description: '', image_url: '', provider_type: 'general_worker', base_fare: 299, is_active: true, sort_order: 100 };
const money = (value) => Number(value || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function parseTaskOptions(value) {
  const options = [...new Set(String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
  if (options.length > 30) throw new Error('A service can have at most 30 task suggestions.');
  if (options.some((item) => item.length > 80)) throw new Error('Each task suggestion must be 80 characters or fewer.');
  return options;
}

function parsePricingRule(value) {
  if (!String(value || '').trim()) return null;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Pricing rule must be a JSON object.');
  return parsed;
}

export default function ServiceCatalog() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [newService, setNewService] = useState({ key: '', ...empty, pricing_rule_json: '', task_options_text: '' });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const rows = await apiGet('/catalog/admin/services');
      const ordered = [...rows].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.label).localeCompare(String(b.label)));
      setItems(ordered);
      setDraft(Object.fromEntries(ordered.map((row) => [row.category_key, {
        ...row,
        base_fare: Number(row.base_fare),
        sort_order: Number(row.sort_order || 0),
        pricing_rule_json: row.metadata?.pricingRule ? JSON.stringify(row.metadata.pricingRule, null, 2) : '',
        task_options_text: Array.isArray(row.metadata?.taskOptions) ? row.metadata.taskOptions.join('\n') : '',
      }])));
    } catch (e) {
      setError(e.message || 'Could not load the service catalog.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const activeCount = items.filter((item) => item.is_active).length;
  const archivedCount = items.length - activeCount;
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? item.is_active : !item.is_active);
      const matchesSearch = !query || [item.label, item.category_key, item.description, item.provider_type]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [items, search, statusFilter]);

  function change(key, field, value) {
    setDraft((old) => ({ ...old, [key]: { ...old[key], [field]: value } }));
  }

  function validateBaseFare(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error('Upfront booking amount must be between ₹0.01 and ₹1,00,000.');
    return amount;
  }

  function validateImageUrl(value) {
    const url = String(value || '').trim();
    if (url && !/^https:\/\//i.test(url)) throw new Error('Service image URL must start with https://');
    return url;
  }

  async function addService(event) {
    event.preventDefault();
    const key = newService.key.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,59}$/.test(key)) {
      setError('Service key must be 2–60 characters: lowercase letters, numbers and underscores only.');
      return;
    }
    if (items.some((item) => item.category_key === key)) {
      setError('This service key already exists. Use the existing service card to edit or restore it.');
      return;
    }
    if (!newService.label.trim()) { setError('Service name is required.'); return; }
    let pricingRule;
    try {
      pricingRule = parsePricingRule(newService.pricing_rule_json);
      const taskOptions = parseTaskOptions(newService.task_options_text);
      const metadata = { ...(pricingRule ? { pricingRule } : {}), ...(taskOptions.length ? { taskOptions } : {}) };
      const baseFare = validateBaseFare(newService.base_fare);
      const imageUrl = validateImageUrl(newService.image_url);
      setSaving('new'); setError(''); setNotice('');
      await apiPut(`/catalog/admin/services/${encodeURIComponent(key)}`, {
        ...newService, image_url: imageUrl, metadata,
        base_fare: baseFare, sort_order: Number(newService.sort_order),
      });
      setNotice(`${newService.label.trim()} added to the catalog.`);
      setNewService({ key: '', ...empty, pricing_rule_json: '', task_options_text: '' });
      await load();
    } catch (e) {
      setError(e.message || 'Service could not be added.');
    } finally {
      setSaving('');
    }
  }

  async function save(key) {
    const item = draft[key];
    try {
      const baseFare = validateBaseFare(item.base_fare);
      const imageUrl = validateImageUrl(item.image_url);
      const sortOrder = Number(item.sort_order);
      if (!item.label?.trim()) throw new Error('Service name is required.');
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) throw new Error('Display order must be a whole number from 0 to 100000.');
      const pricingRule = parsePricingRule(item.pricing_rule_json);
      const taskOptions = parseTaskOptions(item.task_options_text);
      const metadata = { ...(item.metadata || {}) };
      if (pricingRule) metadata.pricingRule = pricingRule;
      else delete metadata.pricingRule;
      if (taskOptions.length) metadata.taskOptions = taskOptions;
      else delete metadata.taskOptions;
      setSaving(key); setError(''); setNotice('');
      await apiPut(`/catalog/admin/services/${encodeURIComponent(key)}`, {
        label: item.label.trim(), description: item.description || '', image_url: imageUrl,
        provider_type: item.provider_type, base_fare: baseFare, is_active: !!item.is_active,
        sort_order: sortOrder, metadata,
      });
      setNotice(`${item.label.trim()} saved. Customer and partner catalog will use this display order.`);
      await load();
    } catch (e) {
      setError(e.message || 'Service could not be saved.');
    } finally {
      setSaving('');
    }
  }

  async function setArchived(item, archived) {
    const action = archived ? 'restore' : 'archive';
    const confirmed = window.confirm(archived
      ? `Restore “${item.label}” and show it for new bookings?`
      : `Archive “${item.label}”? Existing bookings, partner skills and payment history will be preserved.`);
    if (!confirmed) return;
    setSaving(item.category_key); setError(''); setNotice('');
    try {
      if (archived) {
        const current = draft[item.category_key] || item;
        await apiPut(`/catalog/admin/services/${encodeURIComponent(item.category_key)}`, {
          label: current.label, description: current.description || '', image_url: current.image_url || '',
          provider_type: current.provider_type, base_fare: validateBaseFare(current.base_fare),
          is_active: true, sort_order: Number(current.sort_order), metadata: current.metadata || {},
        });
      } else {
        await apiDelete(`/catalog/admin/services/${encodeURIComponent(item.category_key)}`);
      }
      setNotice(`${item.label} ${action}d successfully. Historical records remain unchanged.`);
      await load();
    } catch (e) {
      setError(e.message || `Service could not be ${action}d.`);
    } finally {
      setSaving('');
    }
  }

  return (
    <section className="catalog-page">
      <header className="catalog-header">
        <div>
          <span className="catalog-eyebrow">ADMIN · HOME SERVICES</span>
          <h1>Service Catalog</h1>
          <p>Manage the services customers see and partners can accept. Display numbers follow the saved order.</p>
        </div>
        <div className="catalog-header-actions">
          <button className="btn btn-approve" type="button" onClick={() => document.getElementById('catalog-add-service')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>+ Add service</button>
          <button className="catalog-refresh" type="button" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh catalog'}</button>
        </div>
      </header>

      <div className="catalog-stats">
        <article><span>Total services</span><strong>{items.length}</strong></article>
        <article><span>Visible for booking</span><strong>{activeCount}</strong></article>
        <article><span>Archived / hidden</span><strong>{archivedCount}</strong></article>
      </div>

      <div className="catalog-info">
        <strong>Before publishing a service</strong>
        <span>Check its name, image, provider type, upfront wallet reservation amount and display order. Archiving only hides it from new bookings; past bookings and partner history are retained. Advanced pricing JSON is saved as configuration and does not by itself activate a new pricing flow in booking checkout.</span>
      </div>

      {error && <div className="topup-alert topup-alert-error" role="alert">{error}</div>}
      {notice && <div className="topup-alert topup-alert-success" role="status">{notice}</div>}

      <form id="catalog-add-service" className="catalog-add-card" onSubmit={addService}>
        <div className="catalog-section-heading">
          <div><span className="catalog-eyebrow">NEW ENTRY</span><h2>Add a service</h2></div>
          <span className="catalog-required">* Required fields</span>
        </div>
        <div className="catalog-form-grid">
          <label>Service key *<input required value={newService.key} onChange={(e) => setNewService((v) => ({ ...v, key: e.target.value }))} placeholder="home_deep_cleaning" /></label>
          <label>Customer-facing name *<input required maxLength={120} value={newService.label} onChange={(e) => setNewService((v) => ({ ...v, label: e.target.value }))} placeholder="Home Deep Cleaning" /></label>
          <label>Upfront booking amount (₹) *<input required type="number" min="0.01" max="100000" step="0.01" value={newService.base_fare} onChange={(e) => setNewService((v) => ({ ...v, base_fare: e.target.value }))} /></label>
          <label>Provider type *<select value={newService.provider_type} onChange={(e) => setNewService((v) => ({ ...v, provider_type: e.target.value }))}><option value="general_worker">General worker</option><option value="skilled_worker">Skilled worker</option></select></label>
          <label>Display order *<input required type="number" min="0" step="1" value={newService.sort_order} onChange={(e) => setNewService((v) => ({ ...v, sort_order: e.target.value }))} /><small>Lower number appears earlier in the app.</small></label>
          <label>Service image URL<input type="url" value={newService.image_url} onChange={(e) => setNewService((v) => ({ ...v, image_url: e.target.value }))} placeholder="https://…" /><small>HTTPS image link only.</small></label>
          <label className="catalog-wide">Description<textarea rows="2" maxLength={4000} value={newService.description} onChange={(e) => setNewService((v) => ({ ...v, description: e.target.value }))} placeholder="Explain what is included in this service." /></label>
          <label className="catalog-wide">Customer task suggestions (one per line)<textarea rows="3" maxLength={2500} value={newService.task_options_text} onChange={(e) => setNewService((v) => ({ ...v, task_options_text: e.target.value }))} placeholder={"Installation / setup\nRepair / troubleshooting\nMaintenance\nOther"} /><small>Optional. These appear as selectable tasks in the customer app; leave blank to use sensible defaults.</small></label>
          <label className="catalog-wide">Advanced pricing rule JSON (optional)<textarea rows="4" value={newService.pricing_rule_json} onChange={(e) => setNewService((v) => ({ ...v, pricing_rule_json: e.target.value }))} placeholder={'{"pricingMode":"fixed","variants":[{"key":"1bhk","label":"1 BHK","price":1299}],"addOns":[]}'}/><small>Only configure this when the corresponding customer quote and booking flow supports the rule.</small></label>
        </div>
        <div className="catalog-form-actions"><button className="btn btn-approve" type="submit" disabled={saving === 'new'}>{saving === 'new' ? 'Adding service…' : '+ Add service'}</button></div>
      </form>

      <div className="catalog-list-heading">
        <div><span className="catalog-eyebrow">SERVICE DIRECTORY</span><h2>All services <span>{visibleItems.length}</span></h2></div>
        <div className="catalog-filters">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search service name or key…" aria-label="Search services" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter service status"><option value="all">All services</option><option value="active">Active only</option><option value="archived">Archived only</option></select>
        </div>
      </div>

      {loading ? <div className="topup-empty">Loading service catalog…</div> : visibleItems.length === 0 ? (
        <div className="topup-empty">{items.length ? 'No services match this search or filter.' : 'No services found. Check that database migration 016 has been applied.'}</div>
      ) : (
        <div className="catalog-list">
          {visibleItems.map((item) => {
            const d = draft[item.category_key] || item;
            const number = items.findIndex((entry) => entry.category_key === item.category_key) + 1;
            const busy = saving === item.category_key;
            return (
              <article className={item.is_active ? 'catalog-service-card' : 'catalog-service-card is-archived'} key={item.category_key}>
                <div className="catalog-service-visual">
                  <span className="catalog-serial">#{String(number).padStart(2, '0')}</span>
                  {d.image_url ? <img src={d.image_url} alt={d.label || item.label} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <div className="catalog-image-placeholder">No image</div>}
                  <span className={item.is_active ? 'catalog-status is-active' : 'catalog-status is-archived'}>{item.is_active ? 'Visible' : 'Archived'}</span>
                  <small>{item.category_key}</small>
                </div>
                <div className="catalog-service-content">
                  <div className="catalog-service-title"><div><h3>{d.label || item.label}</h3><p>{d.description || 'No service description added yet.'}</p></div><strong>{money(d.base_fare)}</strong></div>
                  <div className="catalog-service-fields">
                    <label>Service name<input value={d.label || ''} maxLength={120} onChange={(e) => change(item.category_key, 'label', e.target.value)} /></label>
                    <label>Image URL<input value={d.image_url || ''} onChange={(e) => change(item.category_key, 'image_url', e.target.value)} placeholder="https://…" /></label>
                    <label>Upfront booking amount (₹)<input type="number" min="0.01" max="100000" step="0.01" value={d.base_fare ?? ''} onChange={(e) => change(item.category_key, 'base_fare', e.target.value)} /></label>
                    <label>Provider type<select value={d.provider_type} onChange={(e) => change(item.category_key, 'provider_type', e.target.value)}><option value="general_worker">General worker</option><option value="skilled_worker">Skilled worker</option></select></label>
                    <label>Display order<input type="number" min="0" max="100000" step="1" value={d.sort_order ?? 0} onChange={(e) => change(item.category_key, 'sort_order', e.target.value)} /><small>Lower = earlier in customer and partner app.</small></label>
                    <label className="catalog-toggle"><input type="checkbox" checked={!!d.is_active} onChange={(e) => change(item.category_key, 'is_active', e.target.checked)} /> Show to customers</label>
                    <label className="catalog-wide">Description<textarea rows="2" maxLength={4000} value={d.description || ''} onChange={(e) => change(item.category_key, 'description', e.target.value)} /></label>
                    <label className="catalog-wide">Customer task suggestions (one per line)<textarea rows="3" maxLength={2500} value={d.task_options_text || ''} onChange={(e) => change(item.category_key, 'task_options_text', e.target.value)} placeholder={"Installation / setup\nRepair / troubleshooting\nMaintenance\nOther"} /><small>Optional. These appear as selectable tasks in the customer app; leave blank to use sensible defaults.</small></label>
                    <label className="catalog-wide">Advanced pricing rule JSON<textarea rows="3" value={d.pricing_rule_json || ''} onChange={(e) => change(item.category_key, 'pricing_rule_json', e.target.value)} placeholder={'{"pricingMode":"per_unit","unitPrice":349,"unitLabel":"room","minimumQuantity":1,"maximumQuantity":20,"quantityStep":1,"addOns":[]}'}/><small>Saving this rule does not activate unsupported checkout behaviour.</small></label>
                  </div>
                  <div className="catalog-card-actions">
                    <button className="btn btn-approve" type="button" disabled={busy} onClick={() => save(item.category_key)}>{busy ? 'Saving…' : 'Save changes'}</button>
                    {item.is_active
                      ? <button className="btn btn-reject" type="button" disabled={busy} onClick={() => setArchived(item, false)}>Delete / hide service</button>
                      : <button className="btn btn-light" type="button" disabled={busy} onClick={() => setArchived(item, true)}>Restore service</button>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
