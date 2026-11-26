/**
 * Translates low-level Firebase / Google Cloud errors into clear, safe messages.
 * Messages name settings and Console locations; they never include secret values.
 */
export interface DescribedError {
  code: string;
  message: string;
}

export function describeFirebaseError(err: unknown): DescribedError | null {
  const e = err as { code?: unknown; message?: unknown; errorInfo?: { code?: string } };
  const msg = String(e?.message ?? '');
  const code = e?.code;
  const db = process.env.FIRESTORE_DATABASE_ID?.trim() || '(default)';
  const project = process.env.FIREBASE_PROJECT_ID?.trim() || '(not set)';

  if (/Failed to parse private key|Invalid PEM|DECODER routines|error:1E08010C/i.test(msg)) {
    return {
      code: 'FIREBASE_BAD_PRIVATE_KEY',
      message:
        'FIREBASE_PRIVATE_KEY could not be read. Paste the "private_key" value from the service-account JSON on one line, keeping the \\n sequences, inside double quotes in .env.',
    };
  }
  if (/invalid_grant|Invalid JWT|account not found|invalid_client/i.test(msg)) {
    return {
      code: 'FIREBASE_BAD_CREDENTIALS',
      message:
        'Google rejected the service-account credentials. Check FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY come from the same, current key of this project (the key may have been deleted), and that your PC clock is correct.',
    };
  }
  if (/Cloud Firestore API has not been used|firestore\.googleapis\.com.*(disabled|not been used)/i.test(msg)) {
    return {
      code: 'FIRESTORE_API_DISABLED',
      message: `The Cloud Firestore API is not enabled for project "${project}". Check FIREBASE_PROJECT_ID, or open Firestore Database in the Firebase Console once.`,
    };
  }
  if (code === 5 || /^5 NOT_FOUND/.test(msg)) {
    return {
      code: 'FIRESTORE_DATABASE_NOT_FOUND',
      message: `Firestore database "${db}" was not found in project "${project}". Check FIREBASE_PROJECT_ID, and set FIRESTORE_DATABASE_ID if your database is not named "(default)".`,
    };
  }
  if (code === 7 || /^7 PERMISSION_DENIED/.test(msg)) {
    return {
      code: 'FIREBASE_PERMISSION_DENIED',
      message: `The service account is not allowed to use Firestore in project "${project}". Make sure the key was generated in this project (Project settings > Service accounts). Do not change Firestore rules to fix this — the server does not use them.`,
    };
  }
  if (code === 16 || /^16 UNAUTHENTICATED/.test(msg)) {
    return {
      code: 'FIREBASE_BAD_CREDENTIALS',
      message: 'Firestore rejected the server credentials. Generate a new service-account key and update FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.',
    };
  }
  if (code === 14 || /^14 UNAVAILABLE|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(msg)) {
    return {
      code: 'FIREBASE_UNREACHABLE',
      message: process.env.FIRESTORE_EMULATOR_HOST
        ? 'Cannot reach the Firestore emulator. Start it, or remove FIRESTORE_EMULATOR_HOST from .env.'
        : 'Cannot reach Firebase. Check this computer’s internet connection and try again.',
    };
  }
  return null;
}
