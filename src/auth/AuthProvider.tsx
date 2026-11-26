import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut as fbSignOut, type User } from 'firebase/auth';
import type { Me } from '../../shared/types';
import { ApiError, apiFetch, setDevPasscode, type FetchOptions } from '../lib/api';
import { useConfig } from '../lib/config';
import { firebaseConfigProblem, getFirebaseAuth } from '../lib/firebase';

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out'; message?: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; me: Me };

interface AuthValue {
  state: State;
  /** Why Google sign-in can't work in this browser setup (missing VITE_ settings, project mismatch), or null. */
  googleProblem: string | null;
  signInWithGoogle(): Promise<void>;
  /** Local passwordless test sign-in (development only). `passcode` is needed from phones with `npm run dev:lan`. */
  signInAsTest(email: string, passcode?: string): void;
  signOut(): Promise<void>;
  /** Calls the API with a fresh sign-in token. */
  call<T>(path: string, opts?: Omit<FetchOptions, 'token'>): Promise<T>;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);
const TEST_KEY = 'rm-test-signin-email';
const PASS_KEY = 'rm-test-signin-passcode';

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
const readTestEmail = () => readSession(TEST_KEY);
// Restore the LAN passcode for this tab (sessionStorage: forgotten when the tab closes).
setDevPasscode(readSession(PASS_KEY));

export function googleErrorMessage(e: unknown): string | null {
  const code = (e as { code?: string })?.code ?? '';
  if (/popup-closed-by-user|cancelled-popup-request/.test(code)) return null; // user closed the window
  if (/popup-blocked/.test(code)) return 'The sign-in window was blocked. Allow pop-ups for this site and try again.';
  if (/unauthorized-domain/.test(code))
    return `This address (${window.location.hostname}) is not allowed to sign in. Add it in Firebase Console > Authentication > Settings > Authorized domains.`;
  if (/operation-not-allowed/.test(code)) return 'Google sign-in is not enabled in Firebase (Authentication > Sign-in method).';
  if (/network-request-failed/.test(code)) return 'Network error. Check your internet connection.';
  return 'Google sign-in failed. Please try again.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const testAllowed = config.devStaffLogin;
  const browserProject = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  const googleProblem =
    firebaseConfigProblem() ??
    (config.firebaseProjectId && browserProject !== config.firebaseProjectId
      ? `Browser sign-in is set to Firebase project "${browserProject}" but the server uses "${config.firebaseProjectId}". Make VITE_FIREBASE_PROJECT_ID match FIREBASE_PROJECT_ID in .env, then restart.`
      : null);

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [user, setUser] = useState<User | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(!!googleProblem);
  const [testEmail, setTestEmail] = useState<string | null>(() => (testAllowed ? readTestEmail() : null));
  // Bumped on every test sign-in click, so retrying the same account (e.g. after a wrong passcode) re-checks.
  const [testAttempt, setTestAttempt] = useState(0);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (testEmail) return `dev:${testEmail}`;
    return user ? user.getIdToken() : null;
  }, [testEmail, user]);

  // Survives the automatic sign-out of an unregistered account, so its explanation stays on screen.
  const signedOutReason = useRef<string | undefined>(undefined);

  const loadMe = useCallback(async (token: string | null) => {
    if (!token) return setState({ kind: 'signed-out', message: signedOutReason.current });
    try {
      const { me } = await apiFetch<{ me: Me }>('/me', { token });
      setState({ kind: 'ready', me });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        // Not registered by an admin: drop the Google session so they can try a different account.
        if (e.code === 'NOT_REGISTERED' && !firebaseConfigProblem()) {
          signedOutReason.current = e.message;
          await fbSignOut(getFirebaseAuth()).catch(() => undefined);
        }
        setState({ kind: 'signed-out', message: e.message });
      } else setState({ kind: 'error', message: e instanceof Error ? e.message : 'Sign-in failed.' });
    }
  }, []);

  // Firebase: follow the Google sign-in session.
  useEffect(() => {
    if (googleProblem) return;
    return onIdTokenChanged(getFirebaseAuth(), (u) => {
      setUser(u);
      setFirebaseReady(true);
    });
  }, [googleProblem]);

  useEffect(() => {
    if (!firebaseReady && !testEmail) return;
    void (async () => {
      setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
      await loadMe(await getToken());
    })();
  }, [firebaseReady, testEmail, testAttempt, user, getToken, loadMe]);

  const value = useMemo<AuthValue>(
    () => ({
      state,
      googleProblem,
      async signInWithGoogle() {
        signedOutReason.current = undefined;
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithPopup(getFirebaseAuth(), provider);
      },
      signInAsTest(email: string, passcode?: string) {
        if (!testAllowed) return;
        const e = email.trim().toLowerCase();
        const pc = passcode?.trim() || null;
        setDevPasscode(pc);
        try {
          sessionStorage.setItem(TEST_KEY, e);
          if (pc) sessionStorage.setItem(PASS_KEY, pc);
          else sessionStorage.removeItem(PASS_KEY);
        } catch {
          /* ignore */
        }
        setState({ kind: 'loading' });
        setTestEmail(e);
        setTestAttempt((n) => n + 1);
      },
      async signOut() {
        setDevPasscode(null);
        try {
          sessionStorage.removeItem(TEST_KEY);
          sessionStorage.removeItem(PASS_KEY);
        } catch {
          /* ignore */
        }
        setTestEmail(null);
        if (!googleProblem) await fbSignOut(getFirebaseAuth());
        setState({ kind: 'signed-out' });
      },
      async call<T>(path: string, opts: Omit<FetchOptions, 'token'> = {}) {
        const token = await getToken();
        try {
          return await apiFetch<T>(path, { ...opts, token });
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) setState({ kind: 'signed-out', message: e.message });
          if (e instanceof ApiError && (e.code === 'ACCOUNT_BLOCKED' || e.code === 'ACCOUNT_PENDING')) void loadMe(token);
          throw e;
        }
      },
      async refresh() {
        await loadMe(await getToken());
      },
    }),
    [state, googleProblem, testAllowed, getToken, loadMe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** Convenience: the signed-in person (only use inside pages protected by RequireAuth). */
export function useMe(): Me {
  const { state } = useAuth();
  if (state.kind !== 'ready') throw new Error('useMe used outside a signed-in page');
  return state.me;
}
