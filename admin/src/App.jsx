import { useState } from 'react';
import Providers from './pages/Providers';
import Plans from './pages/Plans';
import Bookings from './pages/Bookings';
import { BikeIcon, CarIcon, HomeToolIcon } from './components/Icons';
import './App.css';

const TABS = {
  providers: { label: 'Providers', component: Providers },
  bookings: { label: 'Bookings', component: Bookings },
  plans: { label: 'Plans', component: Plans },
};

function Login({ onLogin }) {
  const [key, setKey] = useState('');
  return (
    <div className="login-screen">
      <div className="login-brand">
        <div className="login-icons">
          <BikeIcon className="hero-icon" />
          <CarIcon className="hero-icon" />
          <HomeToolIcon className="hero-icon" />
        </div>
        <h1>Gofixo</h1>
        <p>Rides and home services, run from one console</p>
      </div>
      <div className="login-panel">
        <form
          className="login-box"
          onSubmit={(e) => {
            e.preventDefault();
            onLogin(key);
          }}
        >
          <label htmlFor="admin-key">Admin key</label>
          <input
            id="admin-key"
            type="password"
            placeholder="Enter your key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoFocus
          />
          <button type="submit">Enter console</button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!sessionStorage.getItem('gofixo_admin_key'));
  const [activeTab, setActiveTab] = useState('providers');

  if (!loggedIn) {
    return (
      <Login
        onLogin={(key) => {
          sessionStorage.setItem('gofixo_admin_key', key);
          setLoggedIn(true);
        }}
      />
    );
  }

  const ActiveComponent = TABS[activeTab].component;

  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">G</span>
          <span className="brand-name">Gofixo</span>
        </div>
        <nav>
          {Object.entries(TABS).map(([key, { label }]) => (
            <button
              key={key}
              className={activeTab === key ? 'nav-item active' : 'nav-item'}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-art">
          <BikeIcon />
          <CarIcon />
          <HomeToolIcon />
        </div>
        <button
          className="nav-item logout"
          onClick={() => {
            sessionStorage.removeItem('gofixo_admin_key');
            setLoggedIn(false);
          }}
        >
          Log out
        </button>
      </aside>
      <main className="content">
        <ActiveComponent />
      </main>
    </div>
  );
}
