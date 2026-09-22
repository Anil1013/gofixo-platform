import { useState } from 'react';
import Providers from './pages/Providers';
import Plans from './pages/Plans';
import Bookings from './pages/Bookings';
import './App.css';

const TABS = {
  providers: { label: 'Providers', component: Providers },
  bookings: { label: 'Bookings', component: Bookings },
  plans: { label: 'Subscription Plans', component: Plans },
};

function Login({ onLogin }) {
  const [key, setKey] = useState('');
  return (
    <div className="login-screen">
      <form
        className="login-box"
        onSubmit={(e) => {
          e.preventDefault();
          onLogin(key);
        }}
      >
        <h1>Gofixo Admin</h1>
        <input
          type="password"
          placeholder="Admin key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
        />
        <button type="submit">Log in</button>
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
        <h1>Gofixo Admin</h1>
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
