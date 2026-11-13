import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPut } from '../api';

const empty = { label: '', description: '', image_url: '', provider_type: 'general_worker', base_fare: 0, is_active: true, sort_order: 100 };

export default function ServiceCatalog() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState('');
  const [newService, setNewService] = useState({ key: '', ...empty, pricing_rule_json: '' });

  async function load() {
    setLoading(true); setError('');
    try {
      const rows = await apiGet('/catalog/admin/services');
      setItems(rows);
      setDraft(Object.fromEntries(rows.map((row) => [row.category_key, { ...row, base_fare: Number(row.base_fare), pricing_rule_json: row.metadata?.pricingRule ? JSON.stringify(row.metadata.pricingRule, null, 2) : '' }])));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function change(key, field, value) {
    setDraft((old) => ({ ...old, [key]: { ...old[key], [field]: value } }));
  }

  async function addService() {
    const key = newService.key.trim().toLowerCase();
    if (!key || !newService.label.trim()) {
      setError('Service key and service name are required.');
      return;
    }
    let pricingRule = null;
    try { pricingRule = newService.pricing_rule_json.trim() ? JSON.parse(newService.pricing_rule_json) : null; }
    catch (_) { setError('Pricing rule must be valid JSON.'); return; }
    if (pricingRule && (typeof pricingRule !== 'object' || Array.isArray(pricingRule))) { setError('Pricing rule must be a JSON object.'); return; }
    setSaving('new'); setError(''); setNotice('');
    try {
      await apiPut(`/catalog/admin/services/${encodeURIComponent(key)}`, { ...newService, metadata: pricingRule ? { pricingRule } : {}, base_fare: Number(newService.base_fare), sort_order: Number(newService.sort_order) });
      setNotice(`${newService.label} added. Partners can select it after the catalog refreshes.`);
      setNewService({ key: '', ...empty, pricing_rule_json: '' });
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(''); }
  }

  async function save(key) {
    const item = draft[key];
    let pricingRule = null;
    try { pricingRule = item.pricing_rule_json?.trim() ? JSON.parse(item.pricing_rule_json) : null; }
    catch (_) { setError('Pricing rule must be valid JSON.'); return; }
    if (pricingRule && (typeof pricingRule !== 'object' || Array.isArray(pricingRule))) { setError('Pricing rule must be a JSON object.'); return; }
    setSaving(key); setError(''); setNotice('');
    try {
      await apiPut(`/catalog/admin/services/${encodeURIComponent(key)}`, {
        label: item.label, description: item.description, image_url: item.image_url,
        provider_type: item.provider_type, base_fare: Number(item.base_fare),
        is_active: item.is_active, sort_order: Number(item.sort_order), metadata: pricingRule ? { ...(item.metadata || {}), pricingRule } : {},
      });
      setNotice(`${item.label} saved. Public catalog will refresh shortly.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(''); }
  }

  async function restore(item) {
    const current = draft[item.category_key] || item;
    setSaving(item.category_key); setError(''); setNotice('');
    try {
      await apiPut(`/catalog/admin/services/${encodeURIComponent(item.category_key)}`, {
        label: current.label, description: current.description || '', image_url: current.image_url || '',
        provider_type: current.provider_type, base_fare: Number(current.base_fare),
        is_active: true, sort_order: Number(current.sort_order), metadata: current.metadata || {},
      });
      setNotice(`${item.label} restored and made visible to customers.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(''); }
  }

  async function archive(item) {
    const confirmed = window.confirm(`Delete “${item.label}” from the active service list? Existing bookings and records will be preserved. You can restore it later.`);
    if (!confirmed) return;
    setSaving(item.category_key); setError(''); setNotice('');
    try {
      await apiDelete(`/catalog/admin/services/${encodeURIComponent(item.category_key)}`);
      setNotice(`${item.label} archived. Historical records are preserved; customers can no longer book it.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(''); }
  }

  return <section className="page">
    <header className="page-header">
      <div><h1>Service Catalog</h1><p>Add, edit, show, hide, archive and restore Home Services from one place.</p></div>
      <button onClick={load} disabled={loading}>Refresh services</button>
    </header>
    <div style={{padding:14,marginBottom:18,borderRadius:12,background:'#FFF7E6',color:'#805500',fontSize:13}}>
      The upfront booking amount is reserved from the customer's Gofixo Wallet. For inspection/repair jobs, partners can submit itemised labour/material quotes for customer approval. Archiving hides a service from new bookings but preserves existing bookings, partner skills and payment history.
    </div>
    {error && <p role="alert" style={{color:'#B42318'}}>{error}</p>}
    {notice && <p role="status" style={{color:'#16803C'}}>{notice}</p>}
    {loading ? <p>Loading services…</p> : <>
      <article style={{padding:16,marginBottom:14,border:'1px solid #D0D5DD',borderRadius:14,background:'#fff'}}>
        <h2 style={{marginTop:0}}>Add a new service</h2>
        <p style={{fontSize:13,color:'#667085'}}>Use a permanent key such as home_deep_cleaning. The key cannot be changed after creation.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10}}>
          <label>Service key<input value={newService.key} onChange={e=>setNewService(v=>({...v,key:e.target.value}))} placeholder="home_deep_cleaning" /></label>
          <label>Service name<input value={newService.label} onChange={e=>setNewService(v=>({...v,label:e.target.value}))} /></label>
          <label>Image URL (HTTPS)<input value={newService.image_url} onChange={e=>setNewService(v=>({...v,image_url:e.target.value}))} /></label>
          <label>Upfront booking amount (₹)<input type="number" min="0" value={newService.base_fare} onChange={e=>setNewService(v=>({...v,base_fare:e.target.value}))} /></label>
          <label>Provider type<select value={newService.provider_type} onChange={e=>setNewService(v=>({...v,provider_type:e.target.value}))}><option value="general_worker">General worker</option><option value="skilled_worker">Skilled worker</option></select></label>
          <label>Sort order<input type="number" min="0" value={newService.sort_order} onChange={e=>setNewService(v=>({...v,sort_order:e.target.value}))} /></label>
          <label style={{gridColumn:'1 / -1'}}>Description<textarea rows="2" value={newService.description} onChange={e=>setNewService(v=>({...v,description:e.target.value}))} /></label>
          <label style={{gridColumn:'1 / -1'}}>Dynamic pricing rule JSON (optional)<textarea rows="5" value={newService.pricing_rule_json} onChange={e=>setNewService(v=>({...v,pricing_rule_json:e.target.value}))} placeholder={'{"pricingMode":"per_unit","unitPrice":349,"unitLabel":"room","minimumQuantity":1,"maximumQuantity":20,"quantityStep":1,"addOns":[{"key":"deep_clean","label":"Deep cleaning","price":199}]}'} /></label>
          <div><button disabled={saving==='new'} onClick={addService}>{saving==='new'?'Adding…':'Add service'}</button></div>
        </div>
      </article>
      <div style={{display:'grid',gap:14}}>
        {items.map((item) => {
          const d = draft[item.category_key] || { ...empty, ...item };
          const busy = saving === item.category_key;
          return <article key={item.category_key} style={{display:'grid',gridTemplateColumns:'110px minmax(0,1fr)',gap:16,padding:16,border:'1px solid #E5E7EB',borderRadius:14,background:'#fff'}}>
            <div>
              <img src={d.image_url || ''} alt={d.label} onError={(e) => { e.currentTarget.style.visibility='hidden'; }} style={{width:100,height:88,objectFit:'cover',borderRadius:10,background:'#F3F4F6'}}/>
              <small style={{display:'block',marginTop:6,color:'#667085'}}>{item.category_key}</small>
              <small style={{display:'block',marginTop:4,color:item.is_active?'#16803C':'#B42318'}}>{item.is_active?'Active':'Archived / hidden'}</small>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10}}>
              <label>Service name<input value={d.label || ''} onChange={(e)=>change(item.category_key,'label',e.target.value)} /></label>
              <label>Image URL<input value={d.image_url || ''} onChange={(e)=>change(item.category_key,'image_url',e.target.value)} /></label>
              <label>Upfront booking amount (₹)<input type="number" min="0" value={d.base_fare ?? 0} onChange={(e)=>change(item.category_key,'base_fare',e.target.value)} /></label>
              <label>Provider type<select value={d.provider_type} onChange={(e)=>change(item.category_key,'provider_type',e.target.value)}><option value="general_worker">General worker</option><option value="skilled_worker">Skilled worker</option></select></label>
              <label>Sort order<input type="number" min="0" value={d.sort_order ?? 100} onChange={(e)=>change(item.category_key,'sort_order',e.target.value)} /></label>
              <label style={{display:'flex',alignItems:'center',gap:8}}><input type="checkbox" checked={!!d.is_active} onChange={(e)=>change(item.category_key,'is_active',e.target.checked)} /> Visible to customers</label>
              <label style={{gridColumn:'1 / -1'}}>Description<textarea rows="2" value={d.description || ''} onChange={(e)=>change(item.category_key,'description',e.target.value)} /></label>
              <label style={{gridColumn:'1 / -1'}}>Dynamic pricing rule JSON (optional)<textarea rows="5" value={d.pricing_rule_json || ''} onChange={(e)=>change(item.category_key,'pricing_rule_json',e.target.value)} placeholder={'{"pricingMode":"per_unit","unitPrice":349,"unitLabel":"room","minimumQuantity":1,"maximumQuantity":20,"quantityStep":1,"addOns":[]}'}/></label>
              <div style={{gridColumn:'1 / -1',display:'flex',gap:8,flexWrap:'wrap'}}>
                <button disabled={busy} onClick={()=>save(item.category_key)}>{busy?'Saving…':'Save changes'}</button>
                {item.is_active
                  ? <button disabled={busy} type="button" onClick={()=>archive(item)} style={{background:'#B42318',color:'#fff'}}>Delete / Archive service</button>
                  : <button disabled={busy} type="button" onClick={()=>restore(item)} style={{background:'#16803C',color:'#fff'}}>Restore service</button>}
              </div>
            </div>
          </article>;
        })}
        {!items.length && <p>No services found. Apply migration 016 on the backend database first.</p>}
      </div>
    </>}
  </section>;
}
