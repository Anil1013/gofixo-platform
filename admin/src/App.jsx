import { useState } from 'react';
import Providers from './pages/Providers';
import ServiceCatalog from './pages/ServiceCatalog';
import Plans from './pages/Plans';
import Bookings from './pages/Bookings';
import Customers from './pages/Customers';
import Topups from './pages/Topups';
import Payments from './pages/Payments';
import Payouts from './pages/Payouts';
import SubscriptionPayments from './pages/SubscriptionPayments';
import './App.css';
import './gofixo-professional.css';

const TABS = {
  services: { label: 'Service catalog', group: 'Operations', component: ServiceCatalog },
  bookings: { label: 'Bookings', group: 'Operations', component: Bookings },
  providers: { label: 'Partners', group: 'People', component: Providers },
  customers: { label: 'Customers', group: 'People', component: Customers },
  plans: { label: 'Ride plans', group: 'Payments', component: Plans },
  subscriptionPayments: { label: 'Ride subscription payments', group: 'Payments', component: SubscriptionPayments },
  topups: { label: 'Wallet top-ups', group: 'Payments', component: Topups },
  payments: { label: 'All payments', group: 'Payments', component: Payments },
  payouts: { label: 'Partner payouts', group: 'Payments', component: Payouts },
};

const NAV_GROUPS = ['Operations', 'People', 'Payments'];
const BIKE_IMG = 'https://images.unsplash.com/photo-1767275090329-331c0ffb1005?w=500&h=500&fit=crop&auto=format&q=70';
const CAR_IMG = 'https://images.unsplash.com/photo-1595075036870-1e962c189804?w=500&h=500&fit=crop&auto=format&q=70';
const HOME_IMG = 'https://images.unsplash.com/photo-1758691030988-c7c55ab2ba18?w=500&h=500&fit=crop&auto=format&q=70';

function Login({ onLogin }) {
  const [key, setKey] = useState('');
  return (
    <div className="login-screen">
      <div className="login-hero">
        <div className="hero-photos">
          <img src={BIKE_IMG} alt="Bike rider" />
          <img src={CAR_IMG} alt="Car on road" className="hero-photo-mid" />
          <img src={HOME_IMG} alt="Home service" />
        </div>
        <h1>Gofixo</h1>
        <p>Rides and home services, run from one console</p>
      </div>
      <form className="login-box" onSubmit={(e) => { e.preventDefault(); if (key.trim()) onLogin(key.trim()); }}>
        <label htmlFor="admin-key">Admin key</label>
        <input id="admin-key" type="password" placeholder="Enter your key" value={key} onChange={(e) => setKey(e.target.value)} autoFocus required />
        <button type="submit" disabled={!key.trim()}>Enter console</button>
      </form>
    </div>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!sessionStorage.getItem('gofixo_admin_key'));
  const [activeTab, setActiveTab] = useState('services');

  if (!loggedIn) {
    return <Login onLogin={(key) => { sessionStorage.setItem('gofixo_admin_key', key); setLoggedIn(true); }} />;
  }

  const ActiveComponent = TABS[activeTab].component;
  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">G</span><span className="brand-name">Gofixo</span></div>
        <nav aria-label="Admin sections">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-label">{group}</span>
              {Object.entries(TABS).filter(([, tab]) => tab.group === group).map(([key, tab]) => (
                <button key={key} type="button" className={activeTab === key ? 'nav-item active' : 'nav-item'} aria-current={activeTab === key ? 'page' : undefined} onClick={() => setActiveTab(key)}>
                  {tab.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className="nav-item logout" type="button" onClick={() => { sessionStorage.removeItem('gofixo_admin_key'); setLoggedIn(false); }}>Log out</button>
      </aside>
      <main className="content">
        <div className="admin-topbar"><span>Gofixo Admin Console</span><strong>{TABS[activeTab].label}</strong></div>
        <ActiveComponent />
      </main>
    </div>
  );
}
