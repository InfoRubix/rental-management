import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import type { StaffItem } from '../../../shared/types';
import { Alert, Button, Empty, ItemImage, Loading, StatusBadge } from '../../components/ui';
import { csvFilename, downloadCSV, toCSV } from '../../lib/csv';
import { useStaffQuery } from './shared';

/** Exports the items currently shown (respects search and status filter). Staff-only data. */
function exportItems(items: StaffItem[]) {
  const columns = [
    'Item code', 'Name', 'Category', 'Status', 'Awaiting handover', 'Brand', 'Model', 'Serial number',
    'Location', 'Purchase date', 'Warranty expiry', 'Description', 'Condition notes', 'Registered', 'Last updated',
  ];
  const rows = items.map((i) => [
    i.itemCode, i.name, i.category ?? '', i.status, i.status === 'Available' && i.holdRequestId ? 'Yes' : 'No',
    i.brand ?? '', i.model ?? '', i.serialNumber, i.location, i.purchaseDate, i.warrantyExpiry,
    i.description, i.conditionNotes, i.createdAt.slice(0, 10), i.updatedAt.slice(0, 10),
  ]);
  downloadCSV(csvFilename('items'), toCSV(columns, rows));
}

const FILTERS = [
  ['', 'All active (not inactive)'],
  ['Available', 'Available'],
  ['Awaiting handover', 'Approved, awaiting handover'],
  ['On loan', 'On loan'],
  ['Under maintenance', 'Under maintenance'],
  ['Inactive', 'Inactive'],
  ['all', 'Everything'],
];

export default function ItemsPage() {
  const [params, setParams] = useSearchParams();
  const deleted = (useLocation().state as { deleted?: string } | null)?.deleted;
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);

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

  const { data, error, loading } = useStaffQuery<{ items: StaffItem[] }>(`/admin/items?${new URLSearchParams({ status, q })}`);

  return (
    <>
      <div className="page-head">
        <h1>Items</h1>
        <Link to="/admin/items/new" className="btn btn-primary">
          + Register item
        </Link>
      </div>
      {deleted ? <Alert tone="success">Item {deleted} was deleted permanently.</Alert> : null}
      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="iq">Search</label>
          <input id="iq" type="search" placeholder="Code, name or category" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="is">Status</label>
          <select
            id="is"
            value={status}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('status', e.target.value);
              else next.delete('status');
              setParams(next, { replace: true });
            }}
          >
            {FILTERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </form>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Loading /> : null}
      {data && data.items.length === 0 ? (
        <Empty title="No items found.">
          <Link to="/admin/items/new">Register your first item</Link>
        </Empty>
      ) : null}
      {data && data.items.length > 0 ? (
        <>
          <div className="page-head">
            <p className="muted small">{data.items.length} item(s)</p>
            <div className="button-row">
              <Link className="btn btn-secondary" to={`/admin/labels?ids=${data.items.map((i) => i.id).join(',')}`}>
                Print QR labels for these
              </Link>
              <Button variant="secondary" onClick={() => exportItems(data.items)}>
                Export CSV
              </Button>
            </div>
          </div>
          <ul className="card-list">
            {data.items.map((i) => (
              <li key={i.id}>
                <Link to={`/admin/items/${i.id}`} className="card item-row">
                  <ItemImage src={i.imageUrl} alt="" size="sm" />
                  <div className="card-body">
                    <span className="code">{i.itemCode}</span>
                    <span className="card-title">{i.name}</span>
                    <span className="badges">
                      <StatusBadge status={i.status} />
                      {i.status === 'Available' && i.holdRequestId ? <StatusBadge status="Awaiting handover" /> : null}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
