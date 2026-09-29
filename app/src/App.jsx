import { useEffect, useState } from 'react';
import Auth from './pages/Auth';
import Home from './pages/Home';
import Active from './pages/Active';
import History from './pages/History';
import ProviderHome from './pages/ProviderHome';
import ProviderPlans from './pages/ProviderPlans';
import ProviderDocuments from './pages/ProviderDocuments';
import ProviderHistory from './pages/ProviderHistory';
import Profile from './pages/Profile';
import { apiGet, getToken, getUser, getRole, clearSession } from './api';
import './App.css';
import './gofixo-reference.css';

// Bookings the customer has finished looking at (rated / dismissed) — kept so a page reload doesn't bring them back
const DISMISSED_KEY = 'gofixo_dismissed_bookings';
const RECENT_COMPLETED_MS = 10 * 60 * 1000;

function getDismissed() {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
  } catch {
    return [];
  }
}

function dismissBooking(id) {
  const list = getDismissed();
  if (!list.includes(id)) list.push(id);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(list.slice(-50)));
}

// The booking the customer should be looking at right now (live one, a just-finished one to rate, or a "no provider" notice)
function pickCurrent(bookings) {
  const dismissed = new Set(getDismissed());
  return (
    bookings.find((b) => {
      if (dismissed.has(b.id)) return false;
      if (['requested', 'accepted', 'ongoing', 'no_provider'].includes(b.status)) return true;
      if (b.status === 'completed' && b.completed_at) {
        return Date.now() - new Date(b.completed_at).getTime() < RECENT_COMPLETED_MS;
      }
      return false;
    }) || null
  );
}

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
      setActiveBooking(pickCurrent(bookings));
    } catch {
      // ignore — next poll will retry
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (role === 'customer') checkActiveBooking();
    else setChecking(false);
  }, [user, role]);

  useEffect(() => {
    const handleSessionExpired = () => {
      setUserState(null);
      setRoleState(null);
      setActiveBooking(null);
      setTab('home');
    };
    window.addEventListener('gofixo:session-expired', handleSessionExpired);
    return () => window.removeEventListener('gofixo:session-expired', handleSessionExpired);
  }, []);

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
    { key: 'home', label: 'Home' },
    { key: 'history', label: 'My Bookings' },
    { key: 'profile', label: 'Profile' },
  ];
  const providerTabs = [
    { key: 'home', label: 'Home' },
    { key: 'plans', label: 'Plans' },
    { key: 'docs', label: 'KYC' },
    { key: 'history', label: 'Rides' },
    { key: 'profile', label: 'Profile' },
  ];
  const tabs = role === 'customer' ? customerTabs : providerTabs;

  function renderContent() {
    if (role === 'customer') {
      if (activeBooking) {
        return (
          <Active
            booking={activeBooking}
            onRefresh={checkActiveBooking}
            onDismiss={() => dismissBooking(activeBooking.id)}
            onDone={() => { dismissBooking(activeBooking.id); setActiveBooking(null); }}
          />
        );
      }
      if (tab === 'profile') return <Profile onLogout={logout} />;
      return tab === 'home' ? <Home onBooked={(b) => setActiveBooking(b)} /> : <History />;
    }
    if (tab === 'home') return <ProviderHome onLogout={logout} />;
    if (tab === 'plans') return <ProviderPlans />;
    if (tab === 'docs') return <ProviderDocuments />;
    if (tab === 'profile') return <Profile onLogout={logout} />;
    return <ProviderHistory />;
  }

  const showNav = !(role === 'customer' && activeBooking);

  return (
    <div className={`app-shell role-${role}`}>
      <header className="topbar">
        <span className="topbar-brand">Gofixo</span>
        <div className="topbar-actions"><span className="topbar-role">{role === 'provider' ? 'Partner' : 'Customer'}</span><button className="logout-link" onClick={logout}>Log out</button></div>
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
