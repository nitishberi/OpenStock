import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, type User } from './api';
import ForecastsPage from './pages/Forecasts';
import LabPage from './pages/Lab';
import WatchlistPage from './pages/Watchlist';
import SettingsPage from './pages/Settings';
import OpenInsiderPage from './pages/OpenInsider';
import SignInPage from './pages/SignIn';

function Shell({ user, onSignOut, children }: { user: User; onSignOut: () => void; children: React.ReactNode }) {
  const loc = useLocation();
  const nav = [
    ['/', 'Forecasts'],
    ['/lab', 'Lab'],
    ['/insider', 'OpenInsider'],
    ['/watchlist', 'Watchlist'],
    ['/settings', 'Settings'],
  ] as const;
  return (
    <div className="app-shell">
      <header className="brand-bar">
        <div className="brand">
          Auto<span>DayTrader</span>
        </div>
        <nav className="nav">
          {nav.map(([to, label]) => (
            <Link key={to} to={to} className={loc.pathname === to ? 'active' : ''}>
              {label}
            </Link>
          ))}
          <button type="button" className="btn ghost" onClick={onSignOut}>
            Sign out
          </button>
        </nav>
      </header>
      {children}
      <p style={{ marginTop: '2rem', color: 'var(--muted)', fontSize: '0.8rem' }}>
        Signed in as {user.email}
        {user.isAdmin ? ' · admin' : ''} · localhost only · trading UI off
      </p>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api
      .session()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) {
    return (
      <div className="app-shell">
        <div className="brand">
          Auto<span>DayTrader</span>
        </div>
        <p className="lead">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<SignInPage onAuth={setUser} />} />
      </Routes>
    );
  }

  const signOut = async () => {
    await api.signOut();
    setUser(null);
  };

  return (
    <Shell user={user} onSignOut={signOut}>
      <Routes>
        <Route path="/" element={<ForecastsPage />} />
        <Route path="/lab" element={<LabPage isAdmin={Boolean(user.isAdmin)} />} />
        <Route path="/insider" element={<OpenInsiderPage />} />
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
