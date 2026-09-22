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

export default function App() {
  const [activeTab, setActiveTab] = useState('providers');
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
      </aside>
      <main className="content">
        <ActiveComponent />
      </main>
    </div>
  );
}
