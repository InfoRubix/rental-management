import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '../components/ui';
import { applyUpdate, dismissUpdate, promptInstall, useInstallState, useOnline, useUpdateAvailable } from './pwa';

/** Offline notice (and a short "back online" note). Shown on every page, including the login page. */
export function OfflineBanner() {
  const online = useOnline();
  const wasOffline = useRef(false);
  const [backOnline, setBackOnline] = useState(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setBackOnline(false);
    } else if (wasOffline.current) {
      wasOffline.current = false;
      setBackOnline(true);
      const t = setTimeout(() => setBackOnline(false), 6000);
      return () => clearTimeout(t);
    }
  }, [online]);

  if (!online) {
    return (
      <div className="net-banner net-offline" role="alert">
        <strong>You’re offline.</strong> Requests, approvals, handovers and returns can’t be sent or saved until you
        reconnect. Information on screen may be out of date.
      </div>
    );
  }
  if (backOnline) {
    return (
      <div className="net-banner net-online" role="status">
        <strong>Back online.</strong> Refresh to see the latest availability.{' '}
        <button type="button" className="link-btn" onClick={() => window.location.reload()}>
          Refresh now
        </button>
      </div>
    );
  }
  return null;
}

/** "Update available" prompt. Never reloads by itself, so unsaved forms are not lost. */
export function UpdatePrompt() {
  const available = useUpdateAvailable();
  const [busy, setBusy] = useState(false);
  if (!available) return null;
  return (
    <div className="update-toast" role="status" aria-live="polite">
      <span className="update-toast-icon" aria-hidden="true">
        <Icon name="activity" size={18} />
      </span>
      <div className="update-toast-text">
        <strong>Update available</strong>
        <span>Finish or save anything you’re typing, then update.</span>
      </div>
      <div className="update-toast-actions">
        <Button
          busy={busy}
          onClick={() => {
            setBusy(true);
            applyUpdate();
          }}
        >
          Update
        </Button>
        <Button variant="ghost" onClick={dismissUpdate} disabled={busy}>
          Later
        </Button>
      </div>
    </div>
  );
}

/** Install button when the browser supports it; simple instructions otherwise. Hidden once installed. */
export function InstallApp({ compact = false }: { compact?: boolean }) {
  const { canPrompt, installed } = useInstallState();
  const [showHelp, setShowHelp] = useState(false);
  if (installed) return null;

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const samsung = /SamsungBrowser/i.test(navigator.userAgent);

  return (
    <div className={`install-app ${compact ? 'compact' : ''}`}>
      {canPrompt ? (
        <Button variant="secondary" block={!compact} onClick={() => void promptInstall()}>
          <Icon name="box" size={18} />
          Install app
        </Button>
      ) : (
        <>
          <button type="button" className="link-btn" aria-expanded={showHelp} onClick={() => setShowHelp((v) => !v)}>
            How to install this app on your phone
          </button>
          {showHelp ? (
            <ol className="install-help">
              {ios ? (
                <>
                  <li>Open this page in Safari.</li>
                  <li>
                    Tap the <strong>Share</strong> button.
                  </li>
                  <li>
                    Choose <strong>Add to Home Screen</strong>.
                  </li>
                </>
              ) : samsung ? (
                <>
                  <li>
                    Tap the <strong>menu (☰)</strong> at the bottom.
                  </li>
                  <li>
                    Tap <strong>Add page to</strong> → <strong>Home screen</strong>.
                  </li>
                </>
              ) : (
                <>
                  <li>
                    Open this page in <strong>Chrome</strong>.
                  </li>
                  <li>
                    Tap the <strong>⋮ menu</strong> (top right).
                  </li>
                  <li>
                    Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).
                  </li>
                </>
              )}
            </ol>
          ) : null}
        </>
      )}
    </div>
  );
}
