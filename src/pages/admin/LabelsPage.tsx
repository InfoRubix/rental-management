import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import type { StaffItem } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { itemPublicUrl, QrLabel } from '../../components/QrLabel';
import { Alert, Button, Loading } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { usePublicBaseUrl } from '../../lib/config';
import { LocalhostWarning } from './ItemDetailPage';

/** Printable sheet of QR labels. Use the browser's Print (or "Save as PDF"). */
export default function LabelsPage() {
  const { state, call } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const base = usePublicBaseUrl();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, 200);
  const [items, setItems] = useState<StaffItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copies, setCopies] = useState(1);
  const [size, setSize] = useState<'small' | 'medium' | 'large'>('medium');

  useEffect(() => {
    if (state.kind !== 'ready') return;
    call<{ items: StaffItem[] }>('/admin/items?status=all')
      .then((r) => {
        const byId = new Map(r.items.map((i) => [i.id, i]));
        setItems(ids.map((id) => byId.get(id)).filter((i): i is StaffItem => !!i));
      })
      .catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, call, params]);

  if (state.kind === 'loading') return <Loading />;
  if (state.kind !== 'ready') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;

  return (
    <main className="container labels-page">
      <div className="no-print">
        <p className="breadcrumb">
          <Link to="/admin/items">← Items</Link>
        </p>
        <h1>QR labels</h1>
        <LocalhostWarning url={base} />
        <p className="muted">Each label shows the item name, item code and its QR code. Use your browser’s print dialog (or “Save as PDF”).</p>
        <div className="filters label-options">
          <div className="field">
            <label htmlFor="lbl-copies">Copies of each label</label>
            <select id="lbl-copies" value={copies} onChange={(e) => setCopies(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="lbl-size">Label size</label>
            <select id="lbl-size" value={size} onChange={(e) => setSize(e.target.value as typeof size)}>
              <option value="small">Small (about 4 per row)</option>
              <option value="medium">Medium (3 per row)</option>
              <option value="large">Large (2 per row)</option>
            </select>
          </div>
        </div>
        <Button onClick={() => window.print()} disabled={!items?.length}>
          Print {items?.length ? `${items.length * copies} label${items.length * copies === 1 ? '' : 's'}` : 'labels'}
        </Button>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!items && !error ? <Loading /> : null}
      {items && items.length === 0 ? <Alert tone="info">No items selected.</Alert> : null}
      <div className={`label-sheet label-${size}`}>
        {items?.flatMap((i) =>
          Array.from({ length: copies }, (_, n) => (
            <QrLabel key={`${i.id}-${n}`} name={i.name} code={i.itemCode} url={itemPublicUrl(base, i.id)} />
          )),
        )}
      </div>
    </main>
  );
}
