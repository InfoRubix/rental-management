import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { StaffRequest } from '../../../shared/types';
import { Alert, Button, Empty, Loading } from '../../components/ui';
import { csvFilename, downloadCSV, toCSV } from '../../lib/csv';
import { actorName } from '../../lib/format';
import { RequestCard, useStaffQuery } from './shared';

/**
 * Exports the requests currently shown. Contains customer contact details, so treat the file as
 * confidential. Private staff notes are deliberately left out.
 */
function exportRequests(requests: StaffRequest[]) {
  const columns = [
    'Reference', 'Status', 'Overdue', 'Item code', 'Item name', 'Customer name', 'Phone', 'Email',
    'Preferred borrowing date', 'Expected return date', 'Submitted', 'Approved', 'Approved by',
    'Handed over', 'Handed over by', 'Return requested', 'Returned', 'Received by', 'Return condition',
    'Rejected', 'Cancelled',
  ];
  const d = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 16) : '');
  const rows = requests.map((r) => [
    r.reference, r.status, r.overdue ? 'Yes' : 'No', r.itemCode, r.itemName, r.customerName, r.phone, r.email ?? '',
    r.requestedDate, r.expectedReturnDate, d(r.createdAt), d(r.approvedAt), r.approvedBy ? actorName(r.approvedBy) : '',
    d(r.handoverAt), r.handoverBy ? actorName(r.handoverBy) : '', d(r.returnRequestedAt), d(r.returnedAt),
    r.returnedBy ? actorName(r.returnedBy) : '',
    r.returnCondition === 'good' ? 'Good' : r.returnCondition === 'needs-maintenance' ? 'Needs maintenance' : '',
    d(r.rejectedAt), d(r.cancelledAt),
  ]);
  downloadCSV(csvFilename('requests'), toCSV(columns, rows));
}

const FILTERS = ['Open', 'Pending', 'Approved', 'On loan', 'Return requested', 'Overdue', 'Returned', 'Rejected', 'Cancelled', 'All'];

export default function RequestsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'Open';
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

  const qs = new URLSearchParams({ status: status === 'All' ? '' : status, q });
  const { data, error, loading } = useStaffQuery<{ requests: StaffRequest[] }>(`/admin/requests?${qs}`);

  return (
    <>
      <h1>Requests</h1>
      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="rq">Search</label>
          <input
            id="rq"
            type="search"
            placeholder="Reference, name, phone, item"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="rs">Status</label>
          <select
            id="rs"
            value={status}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              next.set('status', e.target.value);
              setParams(next, { replace: true });
            }}
          >
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f === 'Open' ? 'Open (all in progress)' : f}
              </option>
            ))}
          </select>
        </div>
      </form>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Loading /> : null}
      {data && data.requests.length === 0 ? <Empty title="No requests match these filters." /> : null}
      {data && data.requests.length > 0 ? (
        <>
          <div className="page-head">
            <p className="muted small">{data.requests.length} request(s)</p>
            <Button variant="secondary" onClick={() => exportRequests(data.requests)}>
              Export CSV
            </Button>
          </div>
          <p className="muted small">
            The export contains customer contact details (times in UTC). Keep the file private. Staff notes are not included.
          </p>
          <ul className="card-list">
            {data.requests.map((r) => (
              <RequestCard key={r.id} r={r} />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
