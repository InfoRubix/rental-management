import { timingSafeEqual } from 'node:crypto';
import { getConfig, type ServerConfig } from './config';
import { AppError, ConfigError } from './errors';
import { describeFirebaseError } from './firebaseErrors';
import { MemoryDb } from './db/memory';
import type { Db } from './db/types';
import type { ActorSummary, UserProfile, UserRole, UserStatus } from '../shared/types';
import { getOrCreateUser } from './services/users';
import { sha256 } from './util';

/** Who a valid sign-in token belongs to (says nothing about permissions yet). */
export interface AuthIdentity {
  uid: string;
  email: string | null;
  name: string | null;
  photoUrl: string | null;
  /** e.g. "google.com". Only Google sign-in is accepted. */
  provider: string;
  emailVerified: boolean;
}

/** A signed-in person with their role and account status. */
export interface AppUser {
  uid: string;
  email: string | null;
  name: string | null;
  photoUrl: string | null;
  role: UserRole;
  status: UserStatus;
  /** Local passwordless test sign-in (development only, never stored in the database). */
  localTest: boolean;
  profile: UserProfile;
  /** Test accounts count as complete (they are not stored, so they cannot save a profile). */
  profileComplete: boolean;
}

export interface Backend {
  config: ServerConfig;
  db: Db;
  /** Verifies a Firebase sign-in token. Does NOT check permissions. */
  verifyIdToken(token: string): Promise<AuthIdentity>;
}

// Keep the memory store on globalThis so it survives dev-server module reloads.
const g = globalThis as unknown as { __rmMemoryDb?: MemoryDb; __rmFirebase?: Promise<Backend> };

export function getMemoryDb(): MemoryDb {
  if (!g.__rmMemoryDb) g.__rmMemoryDb = new MemoryDb();
  return g.__rmMemoryDb;
}

/** Test helper: start from an empty in-memory database. */
export function resetMemoryDb(): MemoryDb {
  g.__rmMemoryDb = new MemoryDb();
  return g.__rmMemoryDb;
}

/** Firestore database ID. Most projects use "(default)"; set FIRESTORE_DATABASE_ID only if yours has another name. */
export function firestoreDatabaseId(): string {
  return process.env.FIRESTORE_DATABASE_ID?.trim() || '(default)';
}

type GetFirestore = typeof import('firebase-admin/firestore').getFirestore;
export function firestoreFor(app: import('firebase-admin/app').App, getFirestore: GetFirestore) {
  const id = firestoreDatabaseId();
  return id === '(default)' ? getFirestore(app) : getFirestore(app, id);
}

/** Initialises the Firebase Admin SDK from server-side environment variables (used by the API and CLI scripts). */
export async function getFirebaseAdminApp() {
  const env = process.env;
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) {
    throw new ConfigError(
      'Firebase is not configured on the server: FIREBASE_PROJECT_ID is missing. See README "Firebase setup", or set BACKEND_MODE=memory for local development.',
    );
  }
  const usingEmulator = !!env.FIRESTORE_EMULATOR_HOST;
  if (projectId.startsWith('your-') || (!usingEmulator && /REPLACE_ME|your-firebase-project-id/.test(`${env.FIREBASE_PRIVATE_KEY ?? ''}${env.FIREBASE_CLIENT_EMAIL ?? ''}`))) {
    throw new ConfigError('Firebase server settings still contain the placeholder values from .env.example. Replace FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY with your real values.');
  }
  const { initializeApp, getApps, cert, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  let app = getApps().find((a) => a.name === 'rental-management');
  if (!app) {
    let credential;
    if (usingEmulator) {
      credential = undefined;
    } else if (env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
      credential = cert({
        projectId,
        clientEmail: env.FIREBASE_CLIENT_EMAIL.trim(),
        // Netlify/.env usually store the key with literal "\n" sequences.
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
    } else if (env.GOOGLE_APPLICATION_CREDENTIALS) {
      credential = applicationDefault();
    } else {
      throw new ConfigError(
        'Firebase Admin credentials are missing. Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (or GOOGLE_APPLICATION_CREDENTIALS locally). See README.',
      );
    }
    app = initializeApp({ projectId, ...(credential ? { credential } : {}) }, 'rental-management');
    firestoreFor(app, getFirestore).settings({ ignoreUndefinedProperties: true });
  }
  return { app, usingEmulator, projectId, databaseId: firestoreDatabaseId() };
}

async function createFirebaseBackend(config: ServerConfig): Promise<Backend> {
  const { app, usingEmulator } = await getFirebaseAdminApp();
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  const { FirestoreDb } = await import('./db/firestore');
  const auth = getAuth(app);
  const db = new FirestoreDb(firestoreFor(app, getFirestore));

  return {
    config,
    db,
    async verifyIdToken(token) {
      try {
        const decoded = await auth.verifyIdToken(token, !usingEmulator);
        return {
          uid: decoded.uid,
          email: decoded.email?.toLowerCase() ?? null,
          name: (decoded.name as string | undefined) ?? null,
          photoUrl: (decoded.picture as string | undefined) ?? null,
          provider: decoded.firebase?.sign_in_provider ?? 'unknown',
          emailVerified: decoded.email_verified === true,
        };
      } catch (err) {
        const msg = String((err as Error)?.message ?? '');
        if (/incorrect "aud"|incorrect "iss"/i.test(msg)) {
          throw new ConfigError(
            'Staff sign-in belongs to a different Firebase project than the server. VITE_FIREBASE_PROJECT_ID and FIREBASE_PROJECT_ID must be the same project.',
          );
        }
        // Server credential / network problems must not be disguised as "please sign in again".
        if (describeFirebaseError(err)) throw err;
        throw new AppError(401, 'UNAUTHENTICATED', 'Your sign-in has expired or is invalid. Please sign in again.');
      }
    },
  };
}

function createMemoryBackend(config: ServerConfig): Backend {
  return {
    config,
    db: getMemoryDb(),
    async verifyIdToken(token) {
      // Memory mode has no real accounts. Automated tests may simulate verified sign-ins:
      // "google-test:<uid>:<email>" (Google) or "password-test:<uid>:<email>" (another provider).
      const m = process.env.VITEST ? /^(google|password)-test:([^:]+):(.+)$/.exec(token) : null;
      if (!m) throw new AppError(401, 'UNAUTHENTICATED', 'Invalid development sign-in token.');
      return {
        uid: m[2]!,
        email: m[3]!.toLowerCase(),
        name: m[3]!.split('@')[0] ?? null,
        photoUrl: null,
        provider: m[1] === 'google' ? 'google.com' : 'password',
        emailVerified: true,
      };
    },
  };
}

export async function getBackend(): Promise<Backend> {
  const config = getConfig();
  if (config.mode === 'memory') return createMemoryBackend(config);
  if (!g.__rmFirebase) {
    g.__rmFirebase = createFirebaseBackend(config).catch((err) => {
      g.__rmFirebase = undefined; // allow retry after fixing configuration
      throw err;
    });
  }
  return g.__rmFirebase;
}

function bearerToken(request: Request): string {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in with Google.');
  return match[1]!.trim();
}

/**
 * Identifies the caller. Accepts only Google sign-ins (verified email). The first time a Google account
 * is seen, a user record is created with role "staff" (status "active", or "pending" when
 * accounts are created only for emails an admin registered). Does NOT check status — use requireUser / requireAdmin for that.
 */
/**
 * Facts about the network connection that the browser cannot forge. Only the local Vite dev server
 * sets `socketAddress` (the real TCP peer address); deployed functions and tests leave it undefined.
 */
export interface Peer {
  socketAddress?: string;
}

export async function authenticate(backend: Backend, request: Request, peer: Peer = {}): Promise<AppUser> {
  const token = bearerToken(request);
  if (token.startsWith('dev:') && backend.config.devStaffLogin) return localTestUser(backend, request, token, peer);

  const identity = await backend.verifyIdToken(token);
  if (identity.provider !== 'google.com') {
    throw new AppError(403, 'GOOGLE_REQUIRED', 'Please sign in with a Google account.');
  }
  if (!identity.email || !identity.emailVerified) {
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Your Google account email is not verified.');
  }
  return getOrCreateUser(backend.db, backend.config, identity);
}

/** Any signed-in person whose account is active (staff or admin). */
export async function requireUser(backend: Backend, request: Request, peer: Peer = {}): Promise<AppUser> {
  const user = await authenticate(backend, request, peer);
  if (user.status === 'blocked') {
    throw new AppError(403, 'ACCOUNT_BLOCKED', 'Your account has been blocked. Contact an administrator.');
  }
  if (user.status !== 'active') {
    throw new AppError(403, 'ACCOUNT_PENDING', 'Your account is waiting for an administrator to approve it.');
  }
  return user;
}

/** Signed-in, active, and an admin. */
export async function requireAdmin(backend: Backend, request: Request, peer: Peer = {}): Promise<AppUser> {
  const user = await requireUser(backend, request, peer);
  if (user.role !== 'admin') throw new AppError(403, 'NOT_AUTHORISED', 'Only administrators can do this.');
  return user;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const stripV4Mapped = (a: string) => a.replace(/^::ffff:/i, '');
export function isLoopbackAddress(addr: string): boolean {
  const a = stripV4Mapped(addr);
  return a === '::1' || /^127\./.test(a);
}
/** Private / link-local ranges only (home or office Wi-Fi), never public internet addresses. */
export function isPrivateAddress(addr: string): boolean {
  const a = stripV4Mapped(addr).toLowerCase();
  return (
    /^10\./.test(a) ||
    /^192\.168\./.test(a) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a) ||
    /^169\.254\./.test(a) ||
    /^fe[89ab][0-9a-f]:/.test(a) ||
    /^f[cd][0-9a-f]{2}:/.test(a)
  );
}

/**
 * Where a test sign-in comes from. With the dev server's real socket address the Host header is ignored
 * (the client chooses it, so "Host: localhost" sent from another device must not count).
 * Without it (automated tests, `netlify dev`), fall back to the Host check.
 */
function testSignInOrigin(config: ServerConfig, request: Request, peer: Peer): 'local' | 'lan' | 'refused' {
  if (peer.socketAddress !== undefined) {
    if (isLoopbackAddress(peer.socketAddress)) return 'local';
    if (config.devLanLogin && isPrivateAddress(peer.socketAddress)) return 'lan';
    return 'refused';
  }
  return LOCAL_HOSTS.has(new URL(request.url).hostname) ? 'local' : 'refused';
}

function passcodeMatches(given: string, expected: string): boolean {
  // Compare fixed-length digests so the comparison time reveals nothing about the passcode.
  const norm = (s: string) => sha256(s.replace(/[\s-]/g, '').toUpperCase());
  return timingSafeEqual(Buffer.from(norm(given)), Buffer.from(norm(expected)));
}

/**
 * Local passwordless test sign-in ("dev:<email>"). Only when DEV_STAFF_LOGIN is enabled (or memory mode);
 * only from this computer — or, with `npm run dev:lan`, from a private-network device that also sends the
 * passcode printed in this computer's terminal; and only for emails listed in DEV_ADMIN_EMAILS (admin) or
 * DEV_STAFF_EMAILS (staff). Test identities are never written to the database.
 */
function localTestUser(backend: Backend, request: Request, token: string, peer: Peer): AppUser {
  const origin = testSignInOrigin(backend.config, request, peer);
  if (origin === 'refused') {
    throw new AppError(
      401,
      'UNAUTHENTICATED',
      backend.config.devLanLogin
        ? 'The test sign-in only works from this computer or a device on the same private Wi-Fi network.'
        : 'The test sign-in only works on this computer (localhost). To test from a phone on the same Wi-Fi, start the app with "npm run dev:lan".',
    );
  }
  if (origin === 'lan') {
    const given = request.headers.get('x-dev-passcode') ?? '';
    if (!backend.config.devLanPasscode || !given || !passcodeMatches(given, backend.config.devLanPasscode)) {
      throw new AppError(
        401,
        'DEV_PASSCODE_REQUIRED',
        given
          ? 'Wrong passcode. Use the LAN test passcode shown in the computer’s terminal.'
          : 'Enter the LAN test passcode shown in the computer’s terminal.',
      );
    }
  }
  const email = token.slice(4).trim().toLowerCase();
  if (!email) throw new AppError(401, 'UNAUTHENTICATED', 'Invalid development sign-in token.');
  const role: UserRole | null = backend.config.devAdminEmails.includes(email)
    ? 'admin'
    : backend.config.devStaffEmails.includes(email)
      ? 'staff'
      : null;
  if (!role) throw new AppError(403, 'NOT_AUTHORISED', 'This test account is not listed in DEV_ADMIN_EMAILS or DEV_STAFF_EMAILS.');
  return {
    uid: `local-test-${email}`,
    email,
    name: `${email.split('@')[0]} (test ${role})`,
    photoUrl: null,
    role,
    status: 'active',
    localTest: true,
    profile: { fullName: '', phone: '', department: '' },
    profileComplete: true,
  };
}

export function actorFor(u: AppUser): ActorSummary {
  return { type: u.role === 'admin' ? 'admin' : 'staff', uid: u.uid, email: u.email, name: u.name };
}
