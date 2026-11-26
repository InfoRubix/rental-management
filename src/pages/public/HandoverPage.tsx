import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { HandoverPreview, MyRequestView } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, DefinitionList, Icon, ItemImage, Loading } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';

/** Opened by scanning the QR on the admin's screen. Confirming starts the loan. */
export default function HandoverPage() {
  const { code = '' } = useParams();
  const { call } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<HandoverPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    call<HandoverPreview>(`/my/handover/${encodeURIComponent(code)}`, { signal: ctrl.signal })
      .then(setData)
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [call, code]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ request: MyRequestView }>(`/my/handover/${encodeURIComponent(code)}`, { method: 'POST' });
      navigate(`/my/${r.request.id}`, { replace: true, state: { justHandedOver: true } });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="narrow">
        <h1>Item handover</h1>
        {error ? (
          <>
            <Alert tone="error" title="Cannot use this handover code">
              {error}
            </Alert>
            <Link to="/my">Go to my requests</Link>
          </>
        ) : (
          <Loading label="Checking handover code…" />
        )}
      </div>
    );
  }

  const r = data.request;
  return (
    <div className="narrow">
      <div className="hero">
        <p className="hero-eyebrow">Item handover</p>
        <h1>Did you receive this item?</h1>
        <p className="hero-sub">{data.adminName} is handing this item to you. Confirm only once it is in your hands.</p>
      </div>

      <section className="panel">
        <div className="item-mini">
          <ItemImage src={r.item.imageUrl} alt="" size="sm" />
          <div>
            <strong className="card-title">{r.item.name}</strong>
            <span className="code">{r.item.itemCode}</span>
          </div>
        </div>
        <DefinitionList
          rows={[
            ['Request', r.reference],
            ['Expected return date', formatDate(r.expectedReturnDate)],
          ]}
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button block busy={busy} onClick={() => void confirm()}>
          <Icon name="check" size={20} />
          Yes, I’ve received it
        </Button>
        <p className="hint" style={{ marginTop: 10 }}>
          You become responsible for the item until the admin confirms its return.
        </p>
      </section>
    </div>
  );
}
