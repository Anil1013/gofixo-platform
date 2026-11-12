import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '../api';

const empty = { label: '', description: '', image_url: '', provider_type: 'general_worker', base_fare: 0, is_active: true, sort_order: 100 };

export default function ServiceCatalog() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const rows = await apiGet('/catalog/admin/services');
      setItems(rows);
      setDraft(Object.fromEntries(rows.map((row) => [row.category_key, { ...row, base_fare: Number(row.base_fare) }])));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function change(key, field, value) {
    setDraft((old) => ({ ...old, [key]: { ...old[key], [field]: value } }));
  }

  async function save(key) {
    const item = draft[key];
    setSaving(key); setError(''); setNotice('');
    try {
      await apiPut(`/catalog/admin/services/${encodeURIComponent(key)}`, {
        label: item.label, description: item.description, image_url: item.image_url,
        provider_type: item.provider_type, base_fare: Number(item.base_fare),
        is_active: item.is_active, sort_order: Number(item.sort_order), metadata: item.metadata || {},
      });
      setNotice(`${item.label} saved. Public catalog will refresh shortly.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(''); }
  }

  return <section className="page">
    <header className="page-header"><div><h1>Service Catalog</h1><p>Manage home-service names, photos, visibility and upfront booking amounts.</p></div><button onClick={load}>Refresh</button></header>
    <div style={{padding:14,marginBottom:18,borderRadius:12,background:'#FFF7E6',color:'#805500',fontSize:13}}>
      Important: This amount is used by the booking API as the upfront Home Service fare and is reserved from the customer's Gofixo Wallet at booking. For inspection/repair jobs, the partner submits any additional labour and material costs as an itemised quote; the customer must approve it before the job starts. Keep this amount and the customer-facing booking screen consistent.
    </div>
    {error && <p role="alert" style={{color:'#B42318'}}>{error}</p>}
    {notice && <p role="status" style={{color:'#16803C'}}>{notice}</p>}
    {loading ? <p>Loading services…</p> : <div style={{display:'grid',gap:14}}>
      {items.map((item) => {
        const d = draft[item.category_key] || { ...empty, ...item };
        return <article key={item.category_key} style={{display:'grid',gridTemplateColumns:'110px minmax(0,1fr)',gap:16,padding:16,border:'1px solid #E5E7EB',borderRadius:14,background:'#fff'}}>
          <div><img src={d.image_url || ''} alt={d.label} onError={(e) => { e.currentTarget.style.visibility='hidden'; }} style={{width:100,height:88,objectFit:'cover',borderRadius:10,background:'#F3F4F6'}}/><small style={{display:'block',marginTop:6,color:'#667085'}}>{item.category_key}</small></div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10}}>
            <label>Service name<input value={d.label || ''} onChange={(e)=>change(item.category_key,'label',e.target.value)} /></label>
            <label>Image URL<input value={d.image_url || ''} onChange={(e)=>change(item.category_key,'image_url',e.target.value)} /></label>
            <label>Upfront booking amount (₹)<input type="number" min="0" value={d.base_fare ?? 0} onChange={(e)=>change(item.category_key,'base_fare',e.target.value)} /></label>
            <label>Provider type<select value={d.provider_type} onChange={(e)=>change(item.category_key,'provider_type',e.target.value)}><option value="general_worker">General worker</option><option value="skilled_worker">Skilled worker</option></select></label>
            <label>Sort order<input type="number" min="0" value={d.sort_order ?? 100} onChange={(e)=>change(item.category_key,'sort_order',e.target.value)} /></label>
            <label style={{display:'flex',alignItems:'center',gap:8}}> <input type="checkbox" checked={!!d.is_active} onChange={(e)=>change(item.category_key,'is_active',e.target.checked)} /> Visible to customers</label>
            <label style={{gridColumn:'1 / -1'}}>Description<textarea rows="2" value={d.description || ''} onChange={(e)=>change(item.category_key,'description',e.target.value)} /></label>
            <div style={{gridColumn:'1 / -1'}}><button disabled={saving===item.category_key} onClick={()=>save(item.category_key)}>{saving===item.category_key?'Saving…':'Save service'}</button></div>
          </div>
        </article>;
      })}
      {!items.length && <p>No services found. Apply migration 016 on the backend database first.</p>}
    </div>}
  </section>;
}
