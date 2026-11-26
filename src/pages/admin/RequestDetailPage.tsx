import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { ActivityEntry, ReturnCondition, StaffItem, StaffRequest, StaffRequestAction } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, DefinitionList, Field, Loading, StatusBadge } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { actorName, formatDate, formatDateTime } from '../../lib/format';
import { HandoverQrPanel } from './HandoverQrPanel';
import { ActivityList, useStaffQuery } from './shared';

interface Detail {
  request: StaffRequest;
  item: StaffItem | null;
  activity: ActivityEntry[];
}

const ACTION_LABEL: Record<StaffRequestAction, string> = {
  approve: 'Approve request',
  reject: 'Reject request',
  cancel: 'Cancel request',
  handover: 'Confirm handover',
  'confirm-return': 'Confirm return received',
};

export default function RequestDetailPage() {
  const { id = '' } = useParams();
  const { call } = useAuth();
  const { data, error, loading, reload } = useStaffQuery<Detail>(`/admin/requests/${encodeURIComponent(id)}`);
  const [pending, setPending] = useState<StaffRequestAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [customerMessage, setCustomerMessage] = useState('');
  const [condition, setCondition] = useState<ReturnCondition | ''>('');
  const [conditionNotes, setConditionNotes] = useState('');
  const [staffNotes, setStaffNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    if (data) {
      setStaffNotes(data.request.staffNotes);
      setCustomerMessage(data.request.customerMessage);
    }
  }, [data]);

  // Celebrate when the borrower redeems the handover QR while this page is open.
  const prevStatus = useRef<string | null>(null);
  const status = data?.request.status ?? null;
  useEffect(() => {
    const prev = prevStatus.current;
    if ((prev === 'Pending' || prev === 'Approved') && status === 'On loan') {
      setPending(null);
      setNotice('Handed over ✓ The borrower confirmed receipt. The item is now On loan.');
    }
    prevStatus.current = status;
  }, [status]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return loading ? <Loading /> : null;
  const { request: r, item } = data;

  function start(action: StaffRequestAction) {
    setPending(action);
    setActionError(null);
    setNotice(null);
    setNote('');
    setCondition('');
    setConditionNotes('');
  }

  async function runAction() {
    if (!pending || busy) return;
    if (pending === 'confirm-return' && !condition) {
      setActionError('Choose the condition of the returned item.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await call<{ alreadyDone: boolean }>(`/admin/requests/${r.id}/actions`, {
        body: {
          action: pending,
          note,
          ...(customerMessage !== r.customerMessage ? { customerMessage } : {}),
          ...(pending === 'confirm-return' ? { condition, conditionNotes } : {}),
        },
      });
      setNotice(res.alreadyDone ? 'This was already done (possibly by another staff member). Nothing changed.' : 'Saved.');
      setPending(null);
      await reload();
    } catch (e) {
      setActionError(errorMessage(e));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    setSavingNotes(true);
    setActionError(null);
    try {
      await call(`/admin/requests/${r.id}`, { method: 'PATCH', body: { staffNotes, customerMessage } });
      setNotice('Notes saved.');
      await reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setSavingNotes(false);
    }
  }

  const available: StaffRequestAction[] =
    r.status === 'Pending'
      ? ['approve', 'reject', 'cancel']
      : r.status === 'Approved'
        ? ['handover', 'cancel']
        : r.status === 'On loan' || r.status === 'Return requested'
          ? ['confirm-return']
          : [];

  return (
    <>
      <p className="breadcrumb">
        <Link to="/admin/requests">← Requests</Link>
      </p>
      <div className="page-head">
        <h1>
          Request <span className="code">{r.reference}</span>
        </h1>
      </div>
      <p className="badges">
        <StatusBadge status={r.status} /> {r.overdue ? <StatusBadge status="Overdue" /> : null}
      </p>
      {r.status === 'Approved' ? (
        <Alert tone="info">Approved but <strong>not yet handed over</strong>. The item becomes “On loan” when the borrower scans your handover QR, or when you confirm handover.</Alert>
      ) : null}
      {r.status === 'Return requested' ? (
        <Alert tone="info">The borrower says they are returning the item. Inspect it, then confirm receipt. The item stays “On loan” until then.</Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {actionError ? <Alert tone="error">{actionError}</Alert> : null}

      {available.length ? (
        <section className="panel">
          <h2>Actions</h2>
          {!pending ? (
            <div className="button-row">
              {available.map((a) => (
                <Button key={a} variant={a === 'reject' || a === 'cancel' ? 'secondary' : 'primary'} onClick={() => start(a)}>
                  {ACTION_LABEL[a]}
                </Button>
              ))}
            </div>
          ) : (
            <div className="form">
              <h3>{ACTION_LABEL[pending]}</h3>
              {pending === 'handover' ? (
                <Alert tone="warning">
                  Only confirm when the borrower has <strong>physically received</strong> {r.itemName} ({r.itemCode}).
                </Alert>
              ) : null}
              {pending === 'confirm-return' ? (
                <>
                  <fieldset className="field">
                    <legend>Condition after inspection (required)</legend>
                    <label className="radio">
                      <input type="radio" name="cond" checked={condition === 'good'} onChange={() => setCondition('good')} /> Good —
                      item becomes <strong>Available</strong>
                    </label>
                    <label className="radio">
                      <input
                        type="radio"
                        name="cond"
                        checked={condition === 'needs-maintenance'}
                        onChange={() => setCondition('needs-maintenance')}
                      />{' '}
                      Needs attention — item becomes <strong>Under maintenance</strong>
                    </label>
                  </fieldset>
                  <Field label="Condition notes (staff only, added to the item)">
                    {(p) => <textarea {...p} rows={2} value={conditionNotes} onChange={(e) => setConditionNotes(e.target.value)} maxLength={2000} />}
                  </Field>
                </>
              ) : null}
              <Field label="Internal note for the activity log (staff only)">
                {(p) => <input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
              </Field>
              {pending === 'approve' || pending === 'reject' ? (
                <Field label="Message to borrower (shown under their “My requests”)" hint="For example pick-up instructions or a reason.">
                  {(p) => <textarea {...p} rows={2} value={customerMessage} onChange={(e) => setCustomerMessage(e.target.value)} maxLength={1000} />}
                </Field>
              ) : null}
              <div className="button-row">
                <Button variant={pending === 'reject' || pending === 'cancel' ? 'danger' : 'primary'} busy={busy} onClick={() => void runAction()}>
                  {ACTION_LABEL[pending]}
                </Button>
                <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
                  Back
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {r.status === 'Pending' || r.status === 'Approved' ? <HandoverQrPanel request={r} reload={reload} /> : null}

      <section className="panel">
        <h2>Borrower</h2>
        {!r.borrowerUid ? (
          <p className="muted small">Submitted before Google sign-in was required (no linked account).</p>
        ) : null}
        <DefinitionList
          rows={[
            ['Name', r.customerName],
            ['Email', r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : '—'],
            ['Department / branch', r.department || '—'],
            ['Phone', r.phone ? <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`}>{r.phone}</a> : '—'],
            ['Borrower notes', r.customerNotes || '—'],
          ]}
        />
      </section>

      <section className="panel">
        <h2>Item</h2>
        {item ? (
          <p>
            <Link to={`/admin/items/${item.id}`}>
              {item.name} ({item.itemCode})
            </Link>{' '}
            <StatusBadge status={item.status} />
          </p>
        ) : (
          <p className="muted">Item record missing.</p>
        )}
        <DefinitionList
          rows={[
            ['Preferred borrowing date', formatDate(r.requestedDate)],
            ['Expected return date', formatDate(r.expectedReturnDate)],
            ['Submitted', formatDateTime(r.createdAt)],
            ['Approved', r.approvedAt ? `${formatDateTime(r.approvedAt)} by ${actorName(r.approvedBy)}` : '—'],
            ['Rejected', r.rejectedAt ? `${formatDateTime(r.rejectedAt)} by ${actorName(r.rejectedBy)}` : '—'],
            ['Handed over', r.handoverAt ? `${formatDateTime(r.handoverAt)} by ${actorName(r.handoverBy)}` : '—'],
            ['Return requested', formatDateTime(r.returnRequestedAt)],
            [
              'Return received',
              r.returnedAt
                ? `${formatDateTime(r.returnedAt)} by ${actorName(r.returnedBy)} — ${r.returnCondition === 'good' ? 'good condition' : 'needs maintenance'}`
                : '—',
            ],
            ['Cancelled', r.cancelledAt ? `${formatDateTime(r.cancelledAt)} by ${actorName(r.cancelledBy)}` : '—'],
          ]}
        />
      </section>

      <section className="panel">
        <h2>Notes</h2>
        <Field label="Admin notes (private — never shown to the borrower)">
          {(p) => <textarea {...p} rows={3} value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} maxLength={4000} />}
        </Field>
        <Field label="Message to borrower (visible under their “My requests”)">
          {(p) => <textarea {...p} rows={2} value={customerMessage} onChange={(e) => setCustomerMessage(e.target.value)} maxLength={1000} />}
        </Field>
        <Button
          variant="secondary"
          busy={savingNotes}
          onClick={() => void saveNotes()}
          disabled={staffNotes === r.staffNotes && customerMessage === r.customerMessage}
        >
          Save notes
        </Button>
      </section>

      <section className="section">
        <h2>Activity</h2>
        <ActivityList entries={data.activity} />
      </section>
    </>
  );
}
