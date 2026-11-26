import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ActivityEntry, ItemStatus, MaintenanceEntry, StaffItem, StaffRequest } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { itemPublicUrl, QrLabel, renderLabelPng } from '../../components/QrLabel';
import { Alert, Button, DefinitionList, Field, ItemImage, Loading, StatusBadge } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { isLocalUrl, useConfig, usePublicBaseUrl } from '../../lib/config';
import { actorName, formatDate, formatDateTime } from '../../lib/format';
import { MaintenanceSection } from './MaintenanceSection';
import { ActivityList, RequestList, useStaffQuery } from './shared';

interface Detail {
  item: StaffItem;
  history: StaffRequest[];
  activity: ActivityEntry[];
  maintenance: MaintenanceEntry[];
  cannotDeleteReason: string | null;
}

type Target = Exclude<ItemStatus, 'On loan'>;

export function LocalhostWarning({ url }: { url: string }) {
  if (!isLocalUrl(url)) return null;
  return (
    <Alert tone="warning" title="Do not print this label yet">
      This QR code points to <code>{new URL(url).origin}</code>, which only works on this computer or network. Customers’ phones
      will not be able to open it. Set <code>PUBLIC_BASE_URL</code> to your deployed site address before printing.
    </Alert>
  );
}

export default function ItemDetailPage() {
  const { id = '' } = useParams();
  const { call } = useAuth();
  const base = usePublicBaseUrl();
  const { today } = useConfig();
  const { data, error, loading, reload } = useStaffQuery<Detail>(`/admin/items/${encodeURIComponent(id)}`);
  const [target, setTarget] = useState<Target | null>(null);
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return loading ? <Loading /> : null;
  const { item } = data;
  const url = itemPublicUrl(base, item.id);
  const active = data.history.find((r) => r.id === item.holdRequestId);

  async function deleteItem() {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await call(`/admin/items/${item.id}/delete`, { body: { confirmItemCode: confirmCode } });
      navigate('/admin/items', { replace: true, state: { deleted: item.itemCode } });
    } catch (e) {
      setDeleteError(errorMessage(e));
      await reload();
    } finally {
      setDeleteBusy(false);
    }
  }

  async function changeStatus() {
    if (!target) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await call<{ alreadyDone: boolean }>(`/admin/items/${item.id}/status`, { body: { status: target, note } });
      setNotice(r.alreadyDone ? 'The item already had this status.' : `Status changed to ${target}.`);
      setTarget(null);
      setNote('');
      await reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const png = await renderLabelPng(item.name, item.itemCode, url);
    const a = document.createElement('a');
    a.href = png;
    a.download = `label-${item.itemCode}.png`;
    a.click();
  }

  const options: Array<[Target, string]> = [];
  if (item.status !== 'On loan' && !item.holdRequestId) {
    if (item.status !== 'Available') options.push(['Available', item.status === 'Inactive' ? 'Reactivate (Available)' : 'Mark available']);
    if (item.status !== 'Under maintenance') options.push(['Under maintenance', 'Mark under maintenance']);
    if (item.status !== 'Inactive') options.push(['Inactive', 'Deactivate']);
  }

  return (
    <>
      <p className="breadcrumb">
        <Link to="/admin/items">← Items</Link>
      </p>
      <div className="page-head">
        <h1>
          {item.name} <span className="code">{item.itemCode}</span>
        </h1>
        <Link to={`/admin/items/${item.id}/edit`} className="btn btn-secondary">
          Edit
        </Link>
      </div>
      <p className="badges">
        <StatusBadge status={item.status} />
        {item.status === 'Available' && item.holdRequestId ? <StatusBadge status="Awaiting handover" /> : null}
      </p>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {actionError ? <Alert tone="error">{actionError}</Alert> : null}

      {active ? (
        <Alert tone="info" title={active.status === 'Approved' ? 'Approved, waiting for handover' : 'Currently on loan'}>
          <Link to={`/admin/requests/${active.id}`}>
            {active.reference} — {active.customerName}
          </Link>
          . Resolve this request before changing the item’s status.
        </Alert>
      ) : null}

      <div className="two-col">
        <section className="panel">
          <ItemImage src={item.imageUrl} alt={item.name} size="md" />
          <DefinitionList
            rows={[
              ['Category', item.category ?? '—'],
              ['Brand / model', [item.brand, item.model].filter(Boolean).join(' · ') || '—'],
              ['Serial number (staff only)', item.serialNumber || '—'],
              ['Storage location (staff only)', item.location || '—'],
              ['Purchase date (staff only)', formatDate(item.purchaseDate || null)],
              [
                'Warranty expiry (staff only)',
                item.warrantyExpiry
                  ? `${formatDate(item.warrantyExpiry)}${item.warrantyExpiry < today ? ' — expired' : ''}`
                  : '—',
              ],
              ['Description (public)', item.description || '—'],
              ['Condition notes (staff only)', <span className="pre">{item.conditionNotes || '—'}</span>],
              ['Registered', `${formatDateTime(item.createdAt)} by ${actorName(item.createdBy)}`],
              ['Last updated', `${formatDateTime(item.updatedAt)} by ${actorName(item.updatedBy)}`],
            ]}
          />
        </section>

        <section className="panel">
          <h2>QR label</h2>
          <LocalhostWarning url={url} />
          <QrLabel name={item.name} code={item.itemCode} url={url} />
          <p className="small break">
            Links to: <a href={url}>{url}</a>
          </p>
          <div className="button-row">
            <Button variant="secondary" onClick={() => void download()}>
              Download PNG
            </Button>
            <Link className="btn btn-secondary" to={`/admin/labels?ids=${item.id}`}>
              Print label
            </Link>
          </div>
          <p className="muted small">The QR code is permanent for this item and can be reused for every loan.</p>
        </section>
      </div>

      <section className="panel">
        <h2>Status</h2>
        {item.status === 'On loan' ? (
          <p className="muted">On loan — the status changes when you confirm the return on the request.</p>
        ) : options.length === 0 ? (
          <p className="muted">Status changes are locked while a request is approved for this item.</p>
        ) : !target ? (
          <div className="button-row">
            {options.map(([t, label]) => (
              <Button key={t} variant={t === 'Inactive' ? 'danger' : 'secondary'} onClick={() => setTarget(t)}>
                {label}
              </Button>
            ))}
          </div>
        ) : (
          <div className="form">
            <p>
              Change status from <strong>{item.status}</strong> to <strong>{target}</strong>?
              {target === 'Inactive' ? ' The item will be hidden from customers. Its history is kept.' : ''}
            </p>
            <Field label="Note for the activity log">
              {(p) => <input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
            </Field>
            <div className="button-row">
              <Button variant={target === 'Inactive' ? 'danger' : 'primary'} busy={busy} onClick={() => void changeStatus()}>
                Confirm
              </Button>
              <Button variant="secondary" onClick={() => setTarget(null)}>
                Back
              </Button>
            </div>
          </div>
        )}

        <div className="delete-zone">
          <h3>Delete permanently</h3>
          {data.cannotDeleteReason ? (
            <p className="muted small">
              Not available: {data.cannotDeleteReason} Deactivating hides the item from staff but keeps its records.
            </p>
          ) : !deleteOpen ? (
            <>
              <p className="muted small">
                For items registered by mistake. Only possible while the item has no borrowing or maintenance history. This
                cannot be undone, and any printed QR label for it will stop working.
              </p>
              <Button variant="danger" onClick={() => { setDeleteOpen(true); setDeleteError(null); setConfirmCode(''); }}>
                Delete item…
              </Button>
            </>
          ) : (
            <form
              className="form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void deleteItem();
              }}
            >
              <Alert tone="warning">
                This permanently deletes <strong>{item.name}</strong>. It cannot be undone.
              </Alert>
              <Field label={`Type ${item.itemCode} to confirm`} required error={deleteError ?? undefined}>
                {(p) => (
                  <input
                    {...p}
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value)}
                    autoCapitalize="characters"
                    autoComplete="off"
                  />
                )}
              </Field>
              <div className="button-row">
                <Button
                  type="submit"
                  variant="danger"
                  busy={deleteBusy}
                  disabled={confirmCode.trim().toUpperCase() !== item.itemCode}
                >
                  Delete permanently
                </Button>
                <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      </section>

      <MaintenanceSection
        item={item}
        entries={data.maintenance}
        onSaved={async () => {
          setNotice(null); // an older status message would now be out of date
          setActionError(null);
          await reload();
        }}
      />

      <section className="section">
        <h2>Borrowing history ({data.history.length})</h2>
        <RequestList requests={data.history} empty="This item has not been requested yet." />
      </section>
      <section className="section">
        <h2>Activity</h2>
        <ActivityList entries={data.activity} showItem={false} />
      </section>
    </>
  );
}
