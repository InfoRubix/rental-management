import { useMemo, useState } from 'react';
import type { ActivityEntry } from '../../../shared/types';
import { Alert, Button, Empty, Loading } from '../../components/ui';
import { actorName } from '../../lib/format';
import { ActivityList, useStaffQuery } from './shared';

type Kind = 'all' | 'request' | 'item' | 'user';
const KIND_LABEL: Record<Kind, string> = { all: 'All', request: 'Requests', item: 'Items', user: 'Users' };

/** Local calendar date (YYYY-MM-DD) of an ISO timestamp, so date filters match what people see. */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ActivityPage() {
  const { data, error, loading, reload } = useStaffQuery<{ activity: ActivityEntry[] }>('/admin/activity');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const entries = data?.activity ?? [];

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { all: entries.length, request: 0, item: 0, user: 0 };
    for (const a of entries) {
      const k = a.action.split('.')[0] as Kind;
      if (k in c) c[k]++;
    }
    return c;
  }, [entries]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return entries.filter((a) => {
      if (kind !== 'all' && !a.action.startsWith(`${kind}.`)) return false;
      if (from || to) {
        const day = localDay(a.at);
        if (from && day < from) return false;
        if (to && day > to) return false;
      }
      if (term) {
        const hay = `${a.summary} ${a.itemCode ?? ''} ${a.reference ?? ''} ${a.note ?? ''} ${a.fromStatus ?? ''} ${a.toStatus ?? ''} ${actorName(a.actor)} ${a.actor.email ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [entries, q, kind, from, to]);

  const filtering = !!(q.trim() || kind !== 'all' || from || to);
  const clear = () => {
    setQ('');
    setKind('all');
    setFrom('');
    setTo('');
  };

  return (
    <>
      <div className="page-head">
        <h1>Activity history</h1>
        <Button variant="secondary" onClick={() => void reload()}>
          Refresh
        </Button>
      </div>
      <p className="muted">The most recent 20 changes: who did what, and when. Records are never deleted.</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Loading /> : null}

      {data ? (
        <>
          <form className="panel filter-bar activity-filters" role="search" onSubmit={(e) => e.preventDefault()}>
            <div className="field filter-search">
              <label htmlFor="ac-q">Search</label>
              <input
                id="ac-q"
                type="search"
                placeholder="Name or email of who did it, item code, reference, note…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="field filter-wide">
              <span className="filter-label" id="ac-kind-label">
                Type
              </span>
              <div className="pill-group" role="group" aria-labelledby="ac-kind-label">
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`pill ${kind === k ? 'active' : ''}`}
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                  >
                    {KIND_LABEL[k]}
                    <span className="pill-count">{counts[k]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field filter-date">
              <label htmlFor="ac-from">From</label>
              <input id="ac-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field filter-date">
              <label htmlFor="ac-to">To</label>
              <input id="ac-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="filter-foot">
              <span className="muted small" role="status">
                {filtering ? `${filtered.length} of ${entries.length} entries` : `${entries.length} entries`}
              </span>
              {filtering ? (
                <Button variant="ghost" onClick={clear}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          </form>

          {filtering && filtered.length === 0 ? (
            <Empty title="No activity matches these filters.">
              <Button variant="secondary" onClick={clear}>
                Clear filters
              </Button>
            </Empty>
          ) : (
            <ActivityList entries={filtered} />
          )}
        </>
      ) : null}
    </>
  );
}
