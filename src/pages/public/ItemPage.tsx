import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { PublicItem } from '../../../shared/types';
import { useAuth, useMe } from '../../auth/AuthProvider';
import { Alert, ItemImage, Loading, StatusBadge } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { BorrowDialog } from './BorrowDialog';

/** The page an item's QR code opens. Viewing it never borrows, returns or changes anything. */
export default function ItemPage() {
  const { id = '' } = useParams();
  const { call } = useAuth();
  const me = useMe();
  const [item, setItem] = useState<PublicItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ?borrow=1 opens the borrow pop-up straight away (used by old /item/:id/request links).
  const [params, setParams] = useSearchParams();
  const [borrowOpen, setBorrowOpen] = useState(params.get('borrow') === '1');
  const closeBorrow = () => {
    setBorrowOpen(false);
    if (params.has('borrow')) {
      const next = new URLSearchParams(params);
      next.delete('borrow');
      setParams(next, { replace: true });
    }
  };

  useEffect(() => {
    setItem(null);
    setError(null);
    call<{ item: PublicItem }>(`/items/${encodeURIComponent(id)}`)
      .then((r) => setItem(r.item))
      .catch((e) => setError(errorMessage(e)));
  }, [id, call]);

  if (error) {
    return (
      <>
        <Alert tone="error" title="Item not found">
          {error}
        </Alert>
        <p>
          <Link to="/">Browse all items</Link>
        </p>
      </>
    );
  }
  if (!item) return <Loading label="Loading item…" />;

  const inactive = item.status === 'Inactive';
  return (
    <article className="item-page">
      <p className="breadcrumb">
        <Link to="/">← All items</Link>
      </p>
      <div className="item-layout">
        <ItemImage src={item.imageUrl} alt={item.name} size="lg" />
        <div>
          <h1>{item.name}</h1>
          <p className="code">Item code: {item.itemCode}</p>
          {item.category ? <p className="muted">{item.category}</p> : null}
          {item.brand || item.model ? <p className="muted">{[item.brand, item.model].filter(Boolean).join(' · ')}</p> : null}
          <p>
            <StatusBadge status={item.availability.label} />
          </p>
          {item.description ? <p className="description">{item.description}</p> : null}

          {item.availability.canRequest ? (
            <>
              <button type="button" className="btn btn-primary btn-block" onClick={() => setBorrowOpen(true)}>
                Request to borrow
              </button>
              <BorrowDialog item={item} open={borrowOpen} onClose={closeBorrow} />
              <p className="muted small">
                A request is not a reservation. An admin reviews it and hands the item over. Follow it under “My requests”.
              </p>
            </>
          ) : (
            <Alert tone="info">
              {inactive
                ? 'This item is no longer available for borrowing.'
                : 'This item cannot be requested at the moment. Please check again later.'}
            </Alert>
          )}

          <p className="small">
            Borrowing this item already? Go to <Link to="/my">My requests</Link> to request its return.
          </p>
          {me.role === 'admin' ? (
            <p>
              <Link to={`/admin/items/${item.id}`} className="btn btn-secondary">
                Manage this item (admin)
              </Link>
            </p>
          ) : null}
        </div>
      </div>
      <p className="muted small">Scanning this QR code never borrows or returns the item automatically.</p>
    </article>
  );
}
