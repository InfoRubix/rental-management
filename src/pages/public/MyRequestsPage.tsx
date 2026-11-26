import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { REQUEST_STATUSES, type MyRequestView } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, Empty, Loading, StatusBadge } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';

const OPEN = ['Pending', 'Approved', 'On loan', 'Return requested'];

type StatusFilter = 'all' | 'open' | 'past' | 'overdue' | (typeof REQUEST_STATUSES)[number];

export default function MyRequestsPage() {
  const { call } = useAuth();
  const [requests, setRequests] = useState<MyRequestView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    call<{ requests: MyRequestView[] }>('/my/requests')
      .then((r) => setRequests(r.requests))
      .catch((e) => setError(errorMessage(e)));
  }, [call]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (requests ?? []).filter((r) => {
      if (term) {
        const hay = `${r.reference} ${r.item.name} ${r.item.itemCode} ${r.customerNotes} ${r.customerMessage}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (status === 'open' && !OPEN.includes(r.status)) return false;
      if (status === 'past' && OPEN.includes(r.status)) return false;
      if (status === 'overdue' && !r.overdue) return false;
      if (status !== 'all' && status !== 'open' && status !== 'past' && status !== 'overdue' && r.status !== status) return false;
      if (from && r.requestedDate < from) return false;
      if (to && r.requestedDate > to) return false;
      return true;
    });
  }, [requests, q, status, from, to]);

  const filtering = !!(q.trim() || status !== 'all' || from || to);
  const clear = () => {
    setQ('');
    setStatus('all');
    setFrom('');
    setTo('');
  };

  const open = filtered.filter((r) => OPEN.includes(r.status));
  const past = filtered.filter((r) => !OPEN.includes(r.status));

  const list = (rows: MyRequestView[]) => (
    <ul className="card-list">
      {rows.map((r) => (
        <li key={r.id}>
          <Link to={`/my/${r.id}`} className="card request-card">
            <div className="request-card-top">
              <span className="code">{r.reference}</span>
              <span className="badges">
                <StatusBadge status={r.status} />
                {r.overdue ? <StatusBadge status="Overdue" /> : null}
              </span>
            </div>
            <span className="card-title">{r.item.name}</span>
            <span className="small">
              {formatDate(r.requestedDate)} → {formatDate(r.expectedReturnDate)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <h1>My requests</h1>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!requests && !error ? <Loading /> : null}
      {requests && requests.length === 0 ? (
        <Empty title="You haven't requested anything yet.">
          <Link to="/">Browse items</Link> or scan an item’s QR code.
        </Empty>
      ) : null}
      {requests && requests.length > 0 ? (
        <>
          <form className="panel filter-bar" role="search" onSubmit={(e) => e.preventDefault()}>
            <div className="field filter-search">
              <label htmlFor="mr-q">Search</label>
              <input
                id="mr-q"
                type="search"
                placeholder="Item, item code or reference (RM-…)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="mr-status">Status</label>
              <select id="mr-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                <option value="all">All requests</option>
                <option value="open">In progress</option>
                <option value="past">Past</option>
                <option value="overdue">Overdue</option>
                <optgroup label="Exact status">
                  {REQUEST_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div className="field">
              <label htmlFor="mr-from">Borrowing date from</label>
              <input id="mr-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="mr-to">to</label>
              <input id="mr-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="filter-foot">
              <span className="muted small" role="status">
                {filtering ? `${filtered.length} of ${requests.length} requests` : `${requests.length} requests`}
              </span>
              {filtering ? (
                <Button variant="ghost" onClick={clear}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          </form>

          {filtering && filtered.length === 0 ? (
            <Empty title="No requests match these filters.">
              <Button variant="secondary" onClick={clear}>
                Clear filters
              </Button>
            </Empty>
          ) : (
            <>
              {!filtering || open.length ? (
                <section className="section">
                  <h2>In progress ({open.length})</h2>
                  {open.length ? list(open) : <p className="muted">Nothing in progress.</p>}
                </section>
              ) : null}
              {past.length ? (
                <section className="section">
                  <h2>Past ({past.length})</h2>
                  {list(past)}
                </section>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </>
  );
}
