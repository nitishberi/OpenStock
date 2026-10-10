import { useEffect, useState } from 'react';
import { api } from '../api';

export default function WatchlistPage() {
  const [items, setItems] = useState<Array<{ symbol: string; company: string }>>([]);
  const [symbol, setSymbol] = useState('');
  const [company, setCompany] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .watchlist()
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.addWatch(symbol, company || symbol);
      setItems(r.items);
      setSymbol('');
      setCompany('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (sym: string) => {
    const r = await api.removeWatch(sym);
    setItems(r.items);
  };

  return (
    <section className="panel">
      <h1>Watchlist</h1>
      <p className="lead">Symbols used for forecast runs when you don’t pass an explicit list.</p>
      <form className="row" onSubmit={add} style={{ marginBottom: '1rem' }}>
        <input
          placeholder="Symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          required
          style={{
            padding: '0.55rem 0.7rem',
            borderRadius: '0.45rem',
            border: '1px solid var(--line)',
            background: 'var(--bg2)',
            color: 'var(--ink)',
            width: '7rem',
          }}
        />
        <input
          placeholder="Company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          style={{
            padding: '0.55rem 0.7rem',
            borderRadius: '0.45rem',
            border: '1px solid var(--line)',
            background: 'var(--bg2)',
            color: 'var(--ink)',
            minWidth: '12rem',
          }}
        />
        <button className="btn" type="submit">
          Add
        </button>
      </form>
      {error ? <p className="err">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Company</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.symbol}>
              <td className="mono">{i.symbol}</td>
              <td>{i.company}</td>
              <td>
                <button className="btn ghost" type="button" onClick={() => remove(i.symbol)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
