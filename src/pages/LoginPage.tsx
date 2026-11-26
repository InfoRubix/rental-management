import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { googleErrorMessage, useAuth } from '../auth/AuthProvider';
import { APP_NAME, DevBanner } from '../components/Layout';
import { Alert, Button, Icon, Loading, LogoMark } from '../components/ui';
import { useConfig } from '../lib/config';
import { InstallApp } from '../pwa/PwaUi';

function GoogleLogo() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function LoginPage() {
  const config = useConfig();
  const { state, signInWithGoogle, signInAsTest, googleProblem } = useAuth();
  const [params] = useSearchParams();
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passcode, setPasscode] = useState('');
  // Only a hint for what to show; the server decides from the real connection address.
  const onThisComputer = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  if (state.kind === 'ready') {
    // Staff always start on Browse items unless they were opening a staff page (e.g. an item from a QR code).
    const dest = state.me.role !== 'admin' && safeNext.startsWith('/admin') ? '/' : safeNext;
    return <Navigate to={dest} replace />;
  }

  async function google() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(googleErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const testEmails = [
    ...(config.devAdminEmails ?? []).map((email) => ({ email, role: 'admin' })),
    ...(config.devStaffEmails ?? []).map((email) => ({ email, role: 'staff' })),
  ];
  const showTest = config.devStaffLogin && testEmails.length > 0 && (onThisComputer || config.devLanLogin);
  // "Please sign in with Google." just means "not signed in yet" — not worth a red box.
  const stateMessage =
    state.kind === 'error'
      ? state.message
      : state.kind === 'signed-out' && state.message && !/^Please sign in with Google\.?$/.test(state.message)
        ? state.message
        : null;

  return (
    <div className="auth-page">
      <DevBanner />
      <main className="auth-shell">
        {/* Brand side */}
        <section className="auth-brand">
          <div className="auth-brand-inner">
            <div className="auth-brand-logo">
              <LogoMark size={44} />
              <span>{APP_NAME}</span>
            </div>
            <div className="auth-brand-copy">
              <p className="auth-brand-headline">Borrow, track and return equipment — without the paperwork.</p>
              <p>One place for your team to find items, request them, and hand them over with a quick QR scan.</p>
            </div>
            <ul className="auth-features">
              <li>
                <span className="auth-feature-icon">
                  <Icon name="grid" size={18} />
                </span>
                <span>
                  <strong>Browse the catalogue</strong>
                  <small>See what’s available right now</small>
                </span>
              </li>
              <li>
                <span className="auth-feature-icon">
                  <Icon name="scan" size={18} />
                </span>
                <span>
                  <strong>Scan &amp; hand over</strong>
                  <small>QR codes on every item</small>
                </span>
              </li>
              <li>
                <span className="auth-feature-icon">
                  <Icon name="clock" size={18} />
                </span>
                <span>
                  <strong>Track every loan</strong>
                  <small>Due dates, returns and history</small>
                </span>
              </li>
            </ul>
            <span className="auth-blob auth-blob-1" aria-hidden="true" />
            <span className="auth-blob auth-blob-2" aria-hidden="true" />
          </div>
        </section>

        {/* Form side */}
        <section className="auth-form-side">
          <div className="auth-card">
            <div className="auth-card-logo">
              <LogoMark size={48} />
            </div>
            <div className="auth-panel">
              <h1 className="auth-title">Welcome back 👋</h1>
              <p className="auth-sub">Sign in with the Google account your administrator registered for you.</p>

              {state.kind === 'loading' ? <Loading label="Checking sign-in…" /> : null}
              {stateMessage ? (
                <Alert tone="error" title={state.kind === 'signed-out' && /not registered/i.test(stateMessage) ? 'Account not registered' : undefined}>
                  {stateMessage}
                </Alert>
              ) : null}

              {googleProblem ? (
                <Alert tone="error" title="Google sign-in is not configured">
                  {googleProblem}
                </Alert>
              ) : (
                <Button block onClick={() => void google()} busy={busy} className="google-btn auth-google">
                  {busy ? null : <GoogleLogo />}
                  Sign in with Google
                </Button>
              )}
              {error ? <Alert tone="error">{error}</Alert> : null}

              <p className="auth-note">
                <Icon name="check" size={16} /> Secure Google sign-in. We never see or store your password.
              </p>

              <div className="auth-invite-note">
                <Icon name="users" size={18} />
                <p>
                  <strong>No account yet?</strong> Accounts are created by an administrator. Ask{' '}
                  <a href="mailto:info@rubix.com.my">info@rubix.com.my</a> to register your work email, then sign in here.
                </p>
              </div>
            </div>
          </div>

          {showTest ? (
            <details className="auth-dev">
              <summary>Developer test sign-in</summary>
              <Alert tone="warning">
                {onThisComputer
                  ? 'No password needed on this computer.'
                  : 'From a phone on the same Wi-Fi, enter the passcode shown in the computer’s terminal (npm run dev:lan).'}{' '}
                Refused on deployed sites.
                {config.mode === 'firebase' ? ' Changes are saved to your real Firebase database.' : ''}
              </Alert>
              {!onThisComputer ? (
                <div className="field">
                  <label htmlFor="dev-passcode">LAN test passcode</label>
                  <input
                    id="dev-passcode"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="XXXX-XXXX"
                  />
                </div>
              ) : null}
              <div className="button-row">
                {testEmails.map((t) => (
                  <Button
                    key={t.email}
                    variant="secondary"
                    disabled={!onThisComputer && !passcode.trim()}
                    onClick={() => signInAsTest(t.email, onThisComputer ? undefined : passcode)}
                  >
                    Test {t.role}: {t.email}
                  </Button>
                ))}
              </div>
            </details>
          ) : null}
          {config.devStaffLogin && testEmails.length > 0 && !onThisComputer && !config.devLanLogin ? (
            <Alert tone="info" title="Testing from a phone?">
              The passwordless test sign-in only works on the computer running the app. Restart it there with{' '}
              <code>npm run dev:lan</code> to allow phones on the same Wi-Fi (with a passcode).
            </Alert>
          ) : null}

          <InstallApp />
          <p className="auth-footer">© {new Date().getFullYear()} {APP_NAME}</p>
        </section>
      </main>
    </div>
  );
}
