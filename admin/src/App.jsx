import { useState } from 'react';
import Providers from './pages/Providers';
import Plans from './pages/Plans';
import Bookings from './pages/Bookings';
import './App.css';

const TABS = {
  providers: { label: 'Providers', component: Providers },
  bookings: { label: 'Bookings', component: Bookings },
  plans: { label: 'Plans', component: Plans },
};

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
