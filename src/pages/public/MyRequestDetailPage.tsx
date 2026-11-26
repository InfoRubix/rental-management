import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import type { MyRequestView } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, DefinitionList, ItemImage, Loading, StatusBadge } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';

export default function MyRequestDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navState = location.state as { justSubmitted?: boolean; justHandedOver?: boolean } | null;
  const justSubmitted = navState?.justSubmitted;
  const justHandedOver = navState?.justHandedOver;
  const { call } = useAuth();
  const [data, setData] = useState<MyRequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'return' | 'cancel' | null>(null);
  const [confirming, setConfirming] = useState<'return' | 'cancel' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData((await call<{ request: MyRequestView }>(`/my/requests/${encodeURIComponent(id)}`)).request);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [call, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh when the borrower comes back to this tab/app, so buttons reflect what the admin did meanwhile.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  if (error) {
    return (
      <div className="narrow">
        <Alert tone="error" title="Request not found">
          {error}
        </Alert>
        <Link to="/my">Back to my requests</Link>
      </div>
    );
  }
  if (!data) return <Loading label="Loading your request…" />;

  async function doAction(kind: 'return' | 'cancel') {
    setBusy(kind);
    setActionError(null);
    try {
      const r = await call<{ request: MyRequestView }>(`/my/requests/${encodeURIComponent(id)}/${kind}`, { method: 'POST' });
      setData(r.request);
      setConfirming(null);
      setNotice(
        kind === 'cancel'
          ? 'Your request has been cancelled.'
          : r.request.status === 'Returned'
            ? 'No need — the admin has already received this item and closed the loan. Nothing more to do.'
            : 'Return request sent. Please bring the item to the admin. The loan stays open until the admin inspects the item and confirms receipt.',
      );
    } catch (e) {
      setActionError(errorMessage(e));
      setConfirming(null);
      await load(); // the request probably changed on the admin side; show its current state
    } finally {
      setBusy(null);
    }
  }

  const timeline: Array<[string, string | null]> = [
    ['Submitted', data.createdAt],
    ['Approved', data.approvedAt],
    ['Not approved', data.rejectedAt],
    ['Handed over to you', data.handoverAt],
    ['Return requested', data.returnRequestedAt],
    ['Return confirmed by admin', data.returnedAt],
    ['Cancelled', data.cancelledAt],
  ];

  return (
    <div className="narrow">
      <p className="breadcrumb">
        <Link to="/my">← My requests</Link>
      </p>
      {justSubmitted && !notice ? (
        <Alert tone="success" title="Request submitted">
          An admin will review it. You can check its progress here any time under “My requests”.
        </Alert>
      ) : null}
      {justHandedOver && !notice ? (
        <Alert tone="success" title="Enjoy! The item is now on loan to you">
          Please return it by {formatDate(data.expectedReturnDate)}. When you’re done, use “Request return” below.
        </Alert>
      ) : null}
      <h1>Request {data.reference}</h1>
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <div className="panel">
        <p className="badges">
          <StatusBadge status={data.status} /> {data.overdue ? <StatusBadge status="Overdue" /> : null}
        </p>
        <p>{data.statusExplanation}</p>
        {data.overdue ? (
          <Alert tone="warning" title="Past the expected return date">
            The expected return date was {formatDate(data.expectedReturnDate)}. Please return the item as soon as possible.
          </Alert>
        ) : null}
        {data.customerMessage ? (
          <Alert tone="info" title="Message from the admin">
            {data.customerMessage}
          </Alert>
        ) : null}
      </div>

      <div className="panel item-mini">
        <ItemImage src={data.item.imageUrl} alt="" size="sm" />
        <div>
          <Link to={`/item/${data.item.id}`} className="card-title">
            {data.item.name}
          </Link>
          <div className="code">{data.item.itemCode}</div>
        </div>
      </div>

      <div className="panel">
        <h2>Details</h2>
        <DefinitionList
          rows={[
            ['Department / branch', data.department || '—'],
            ['Phone', data.phone || '—'],
            ['Preferred borrowing date', formatDate(data.requestedDate)],
            ['Expected return date', formatDate(data.expectedReturnDate)],
            ...(data.customerNotes ? ([['Your notes', data.customerNotes]] as Array<[string, string]>) : []),
          ]}
        />
        <h2>Progress</h2>
        <ol className="timeline">
          {timeline
            .filter(([, at]) => at)
            .map(([label, at]) => (
              <li key={label}>
                <strong>{label}</strong> <span className="muted">{formatDateTime(at)}</span>
              </li>
            ))}
        </ol>
      </div>

      {actionError ? <Alert tone="error">{actionError}</Alert> : null}

      {data.canRequestReturn ? (
        <div className="panel">
          <h2>Returning the item</h2>
          {confirming === 'return' ? (
            <>
              <p>
                Confirm that you are returning <strong>{data.item.name}</strong>. The admin will inspect it and confirm receipt —
                until then the loan stays open.
              </p>
              <div className="button-row">
                <Button busy={busy === 'return'} onClick={() => void doAction('return')}>
                  Yes, I am returning it
                </Button>
                <Button variant="secondary" onClick={() => setConfirming(null)}>
                  Not now
                </Button>
              </div>
            </>
          ) : (
            <Button block onClick={() => setConfirming('return')}>
              I am returning this item
            </Button>
          )}
        </div>
      ) : null}

      {data.canCancel ? (
        <div className="panel">
          {confirming === 'cancel' ? (
            <>
              <p>Cancel this request? This cannot be undone.</p>
              <div className="button-row">
                <Button variant="danger" busy={busy === 'cancel'} onClick={() => void doAction('cancel')}>
                  Yes, cancel request
                </Button>
                <Button variant="secondary" onClick={() => setConfirming(null)}>
                  Keep request
                </Button>
              </div>
            </>
          ) : (
            <Button variant="secondary" block onClick={() => setConfirming('cancel')}>
              Cancel this request
            </Button>
          )}
        </div>
      ) : null}

      <Button variant="ghost" onClick={() => void load()}>
        Refresh status
      </Button>
    </div>
  );
}
