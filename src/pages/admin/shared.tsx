import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { ActivityEntry, StaffRequest } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { StatusBadge } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { actorName, formatDate, formatDateTime } from '../../lib/format';

/** Loads a staff endpoint; returns data, error and a reload function. */
export function useStaffQuery<T>(path: string | null) {
  const { call } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await call<T>(path));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [call, path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}

export function RequestCard({ r }: { r: StaffRequest }) {
  return (
    <li>
      <Link to={`/admin/requests/${r.id}`} className="card request-card">
        <div className="request-card-top">
          <span className="code">{r.reference}</span>
          <span className="badges">
            <StatusBadge status={r.status} />
            {r.overdue ? <StatusBadge status="Overdue" /> : null}
          </span>
        </div>
        <span className="card-title">{r.itemName}</span>
        <span className="muted small">
          {r.itemCode} · {r.customerName}{r.department ? ` · ${r.department}` : ''}
        </span>
        <span className="small">
          {formatDate(r.requestedDate)} → {formatDate(r.expectedReturnDate)}
        </span>
      </Link>
    </li>
  );
}

export function RequestList({ requests, empty }: { requests: StaffRequest[]; empty: string }) {
  if (!requests.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="card-list">
      {requests.map((r) => (
        <RequestCard key={r.id} r={r} />
      ))}
    </ul>
  );
}

const EMAIL = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}';
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Activity summary with email addresses and the item code shown in purple. */
export function ActivitySummary({ text, itemCode }: { text: string; itemCode?: string | null }) {
  const pattern = new RegExp(`(${EMAIL}${itemCode ? `|${escapeRegExp(itemCode)}` : ''})`, 'g');
  return (
    <>
      {text.split(pattern).map((part, i) => (i % 2 === 1 ? <span key={i} className="activity-hl">{part}</span> : part))}
    </>
  );
}

export function ActivityList({ entries, showItem = true }: { entries: ActivityEntry[]; showItem?: boolean }) {
  if (!entries.length) return <p className="muted">No activity recorded yet.</p>;
  return (
    <ol className="activity-list">
      {entries.map((a) => (
        <li key={a.id}>
          <div className="activity-head">
            <strong>
              <ActivitySummary text={a.summary} itemCode={a.itemCode} />
            </strong>
          </div>
          <div className="muted small">
            {formatDateTime(a.at)} · by {actorName(a.actor)}
            {a.actor.type === 'staff' && a.actor.email && a.actor.name !== a.actor.email ? ` (${a.actor.email})` : ''}
            {showItem && a.itemId ? (
              <>
                {' · '}
                <Link to={`/admin/items/${a.itemId}`}>{a.itemCode}</Link>
              </>
            ) : null}
            {a.requestId ? (
              <>
                {' · '}
                <Link to={`/admin/requests/${a.requestId}`}>{a.reference}</Link>
              </>
            ) : null}
          </div>
          {a.fromStatus || a.toStatus ? (
            <div className="small">
              {a.fromStatus ?? '—'} → {a.toStatus ?? '—'}
            </div>
          ) : null}
          {a.note ? <div className="small note">Note: {a.note}</div> : null}
        </li>
      ))}
    </ol>
  );
}
