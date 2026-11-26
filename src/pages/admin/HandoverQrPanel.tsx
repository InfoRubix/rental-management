import { useEffect, useState } from 'react';
import type { HandoverCode, StaffRequest } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { useQrDataUrl } from '../../components/QrLabel';
import { Alert, Button, Icon } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { isLocalUrl, usePublicBaseUrl } from '../../lib/config';

export function handoverUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/handover/${encodeURIComponent(code)}`;
}

function secondsLeft(expiresAt: string, now: number) {
  return Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
}

/**
 * Shows a short-lived QR the borrower scans to confirm they physically received the item.
 * While the QR is visible the page re-loads the request every few seconds, so the parent sees it become "On loan".
 */
export function HandoverQrPanel({ request: r, reload }: { request: StaffRequest; reload: () => Promise<void> }) {
  const { call } = useAuth();
  const baseUrl = usePublicBaseUrl();
  const [code, setCode] = useState<HandoverCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const url = code ? handoverUrl(baseUrl, code.code) : '';
  const qr = useQrDataUrl(url || 'about:blank', 480);
  const left = code ? secondsLeft(code.expiresAt, now) : 0;
  const expired = !!code && left === 0;

  // Countdown tick.
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [code]);

  // Watch for the borrower's scan while the code is live.
  useEffect(() => {
    if (!code || expired) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [code, expired, reload]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const c = await call<HandoverCode>(`/admin/requests/${r.id}/handover-code`, { method: 'POST' });
      setNow(Date.now());
      setCode(c);
    } catch (e) {
      setError(errorMessage(e));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');

  return (
    <section className="panel handover-panel">
      <div className="handover-head">
        <span className="dash-section-icon">
          <Icon name="scan" size={18} />
        </span>
        <div>
          <h2>Hand over in person</h2>
          <p className="muted small">
            Show this QR to <strong>{r.customerName}</strong> when you give them the item. When they scan it and confirm, the
            request is {r.status === 'Pending' ? 'approved and ' : ''}marked <strong>On loan</strong> automatically.
          </p>
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {!r.borrowerUid ? (
        <Alert tone="warning">This request has no linked borrower account, so QR handover is not available. Use the buttons above.</Alert>
      ) : !code ? (
        <Button onClick={() => void generate()} busy={busy}>
          <Icon name="scan" size={18} />
          Show handover QR
        </Button>
      ) : (
        <div className="handover-body">
          <div className={`handover-qr ${expired ? 'is-expired' : ''}`}>
            {qr && !expired ? <img src={qr} alt="Handover QR code for the borrower to scan" /> : <div className="qr-placeholder">{expired ? 'Expired' : 'Generating…'}</div>}
          </div>
          <div className="handover-side">
            {expired ? (
              <>
                <Alert tone="warning">This code has expired. Show a new one when the borrower is ready.</Alert>
                <Button onClick={() => void generate()} busy={busy}>
                  Show a new code
                </Button>
              </>
            ) : (
              <>
                <p className="handover-timer" aria-live="off">
                  <Icon name="clock" size={18} /> Expires in{' '}
                  <strong>
                    {mm}:{ss}
                  </strong>
                </p>
                <p className="handover-waiting" role="status">
                  <span className="pulse-dot" aria-hidden="true" /> Waiting for {r.customerName} to scan…
                </p>
                <p className="muted small">Single use. Only the borrower’s account can redeem it. Showing a new code cancels this one.</p>
                <div className="button-row">
                  <Button variant="secondary" onClick={() => void generate()} busy={busy}>
                    New code
                  </Button>
                  <Button variant="ghost" onClick={() => setCode(null)}>
                    Hide
                  </Button>
                </div>
              </>
            )}
            {isLocalUrl(baseUrl) ? (
              <p className="hint">
                This QR points to <code>{baseUrl}</code>, so it only works on this computer or network.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
