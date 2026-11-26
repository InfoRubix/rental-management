import { afterEach, describe, expect, it } from 'vitest';
import { describeFirebaseError } from '../server/firebaseErrors';
import { api } from './helpers';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  (globalThis as { __rmFirebase?: unknown }).__rmFirebase = undefined;
});

describe('Firebase error messages', () => {
  it.each([
    [{ code: 5, message: '5 NOT_FOUND: ' }, 'FIRESTORE_DATABASE_NOT_FOUND'],
    [{ code: 7, message: '7 PERMISSION_DENIED: Missing or insufficient permissions.' }, 'FIREBASE_PERMISSION_DENIED'],
    [{ code: 16, message: '16 UNAUTHENTICATED' }, 'FIREBASE_BAD_CREDENTIALS'],
    [{ message: 'Error fetching access token: invalid_grant (Invalid JWT Signature.)' }, 'FIREBASE_BAD_CREDENTIALS'],
    [{ message: 'Failed to parse private key: Error: Invalid PEM formatted message.' }, 'FIREBASE_BAD_PRIVATE_KEY'],
    [{ code: 14, message: '14 UNAVAILABLE: getaddrinfo ENOTFOUND' }, 'FIREBASE_UNREACHABLE'],
  ])('maps %o to %s', (err, code) => {
    expect(describeFirebaseError(err)?.code).toBe(code);
  });

  it('does not reinterpret unrelated errors', () => {
    expect(describeFirebaseError(new Error('boom'))).toBeNull();
  });

  it('a malformed private key gives a clear 503, never a fallback and never the key itself', async () => {
    const fakeKey = '-----BEGIN PRIVATE KEY-----\\nTHIS-IS-NOT-A-KEY-abc123\\n-----END PRIVATE KEY-----\\n';
    process.env.BACKEND_MODE = 'firebase';
    process.env.FIREBASE_PROJECT_ID = 'demo-check-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'svc@demo-check-project.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = fakeKey;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    const r = await api('GET', '/api/items');
    expect(r.status).toBe(503);
    expect(r.data.error.code).toBe('FIREBASE_BAD_PRIVATE_KEY');
    expect(r.text).not.toContain('THIS-IS-NOT-A-KEY');
  });

  it('placeholder values from .env.example are reported clearly', async () => {
    process.env.BACKEND_MODE = 'firebase';
    process.env.FIREBASE_PROJECT_ID = 'your-firebase-project-id';
    const r = await api('GET', '/api/config');
    expect(r.status).toBe(503);
    expect(r.data.error.message).toMatch(/placeholder/);
  });
});

describe('telling a forged token from a wrong-project token', async () => {
  const { issuedByOtherFirebaseProject } = await import('../server/backend');
  const tok = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;
  it('garbage or forged tokens are just invalid sign-ins', () => {
    expect(issuedByOtherFirebaseProject('not-a-token', 'proj-a')).toBe(false);
    expect(issuedByOtherFirebaseProject(tok({ sub: 'x' }), 'proj-a')).toBe(false);
    expect(issuedByOtherFirebaseProject(tok({ aud: 'proj-b', iss: 'https://evil.example' }), 'proj-a')).toBe(false);
  });
  it('a Firebase token from another project is a configuration problem', () => {
    expect(issuedByOtherFirebaseProject(tok({ aud: 'proj-b', iss: 'https://securetoken.google.com/proj-b' }), 'proj-a')).toBe(true);
    expect(issuedByOtherFirebaseProject(tok({ aud: 'proj-a', iss: 'https://securetoken.google.com/proj-a' }), 'proj-a')).toBe(false);
  });
});
