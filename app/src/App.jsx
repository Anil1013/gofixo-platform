import { useEffect, useState } from 'react';
import Auth from './pages/Auth';
import Home from './pages/Home';
import Active from './pages/Active';
import History from './pages/History';
import ProviderHome from './pages/ProviderHome';
import ProviderPlans from './pages/ProviderPlans';
import ProviderDocuments from './pages/ProviderDocuments';
import ProviderHistory from './pages/ProviderHistory';
import { apiGet, getToken, getUser, getRole, clearSession } from './api';
import './App.css';

export default function App() {
  const [user, setUserState] = useState(getUser());
  const [role, setRoleState] = useState(getRole());
  const [tab, setTab] = useState('home');
  const [activeBooking, setActiveBooking] = useState(null);
  const [checking, setChecking] = useState(true);

  async function checkActiveBooking() {
    if (!getToken() || role !== 'customer') {
      setChecking(false);
      return;
    }
    try {
      const bookings = await apiGet('/bookings/mine', true);
      const active = bookings.find((b) => b.status !== 'completed');
      setActiveBooking(active || null);
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (role === 'customer') checkActiveBooking();
    else setChecking(false);
  }, [user, role]);

  function logout() {
    clearSession();
    setUserState(null);
    setRoleState(null);
    setActiveBooking(null);
    setTab('home');
  }

  if (!user || !role) {
    return <Auth onAuthed={(u, r) => { setUserState(u); setRoleState(r); }} />;
  }

  if (checking) {
    return <div className="screen"><p>Loading...</p></div>;
  }

  const customerTabs = [
    { key: 'home', label: '🏠 Book' },
    { key: 'history', label: '📋 History' },
  ];
  const providerTabs = [
    { key: 'home', label: '🏠 Dashboard' },
    { key: 'plans', label: '💳 Plans' },
    { key: 'docs', label: '📄 KYC' },
    { key: 'history', label: '📋 History' },
  ];
  const tabs = role === 'customer' ? customerTabs : providerTabs;

  function renderContent() {
    if (role === 'customer') {
      if (activeBooking) {
        return <Active booking={activeBooking} onRefresh={checkActiveBooking} onDone={() => setActiveBooking(null)} />;
      }
      return tab === 'home' ? <Home onBooked={(b) => setActiveBooking(b)} /> : <History />;
    }
    // provider
    if (tab === 'home') return <ProviderHome />;
    if (tab === 'plans') return <ProviderPlans />;
    if (tab === 'docs') return <ProviderDocuments />;
    return <ProviderHistory />;
  }

  const showNav = !(role === 'customer' && activeBooking);

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar-brand">Gofixo {role === 'provider' ? '· Partner' : ''}</span>
        <button className="logout-link" onClick={logout}>Log out</button>
      </header>

      <main className="main">{renderContent()}</main>

      {showNav && (
        <nav className="bottom-nav">
          {tabs.map((t) => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
