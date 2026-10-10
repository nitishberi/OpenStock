import { useState } from 'react';
import { api, type User } from '../api';

export default function SignInPage({ onAuth }: { onAuth: (u: User) => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res =
        mode === 'in'
          ? await api.signIn(email, password)
          : await api.signUp(name, email, password);
      onAuth(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="brand-bar">
        <div className="brand">
          Auto<span>DayTrader</span>
        </div>
      </header>
      <section className="panel">
        <h1>{mode === 'in' ? 'Sign in' : 'Create account'}</h1>
        <p className="lead">
          Local prediction app — D1–D5 forecasts, Lab, watchlist. Password needs upper, lower, and a
          digit.
        </p>
        <form className="form" onSubmit={submit}>
          {mode === 'up' ? (
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
          ) : null}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            />
          </label>
          {error ? <p className="err">{error}</p> : null}
          <div className="row">
            <button className="btn" type="submit" disabled={pending}>
              {pending ? '…' : mode === 'in' ? 'Sign in' : 'Sign up'}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
            >
              {mode === 'in' ? 'Need an account?' : 'Have an account?'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
