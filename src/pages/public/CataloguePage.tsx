import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { PublicItem } from '../../../shared/types';
import { Alert, Empty, Icon, ItemImage, Loading, StatusBadge } from '../../components/ui';
import { useAuth } from '../../auth/AuthProvider';
import { errorMessage } from '../../lib/api';

export default function CataloguePage() {
  const { call } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const availability = params.get('availability') ?? '';
  const [search, setSearch] = useState(q);
  const [items, setItems] = useState<PublicItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce typing into the URL (?q=) so results are shareable and the back button works.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) {
        const next = new URLSearchParams(params);
        if (search) next.set('q', search);
        else next.delete('q');
        setParams(next, { replace: true });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search, q, params, setParams]);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    setItems(null);
    const qs = new URLSearchParams({ q, availability });
    call<{ items: PublicItem[] }>(`/items?${qs}`, { signal: ctrl.signal })
      .then((r) => setItems(r.items))
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [q, availability, call]);

  return (
    <>
      <div className="hero">
        <div className="page-head">
          <div>
            <p className="hero-eyebrow">Catalogue</p>
            <h1>Browse items</h1>
            <p className="hero-sub">Find an item to borrow, or scan the QR code on the item. Each physical item has its own code.</p>
          </div>
          <Link to="/scan" className="btn btn-secondary hero-btn">
            <Icon name="scan" size={18} />
            Scan a QR code
          </Link>
        </div>
      </div>

      <form className="filters panel" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" type="search" placeholder="Name, code or category" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="availability">Show</label>
          <select
            id="availability"
            value={availability}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('availability', e.target.value);
              else next.delete('availability');
              setParams(next, { replace: true });
            }}
          >
            <option value="">All items</option>
            <option value="available">Available to request now</option>
          </select>
        </div>
      </form>

      {error ? <Alert tone="error" title="Could not load items">{error}</Alert> : null}
      {!items && !error ? <Loading label="Loading items…" /> : null}
      {items && items.length === 0 ? (
        <Empty title={q || availability ? 'No items match your search.' : 'No items have been added yet.'} />
      ) : null}
      {items && items.length > 0 ? (
        <ul className="card-grid" aria-label="Items">
          {items.map((item) => (
            <li key={item.id}>
              <Link to={`/item/${item.id}`} className="card item-card">
                <ItemImage src={item.imageUrl} alt="" size="md" />
                <div className="card-body">
                  <span className="card-title">{item.name}</span>
                  <span className="code">{item.itemCode}</span>
                  {item.category ? <span className="muted small">{item.category}</span> : null}
                  <StatusBadge status={item.availability.label} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
