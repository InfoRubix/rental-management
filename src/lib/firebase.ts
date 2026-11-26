import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';

// These VITE_ values are the PUBLIC Firebase web-app settings (not secrets).
// Admin credentials live only on the server.
const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

const REQUIRED = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

export function firebaseConfigProblem(): string | null {
  const missing = REQUIRED.filter((k) => {
    const v = import.meta.env[k] as string | undefined;
    return !v || v.startsWith('your-');
  });
  return missing.length ? `Missing browser Firebase settings: ${missing.join(', ')}. See README “Firebase setup”.` : null;
}

export function getFirebaseAuth(): Auth {
  const problem = firebaseConfigProblem();
  if (problem) throw new Error(problem);
  if (!auth) {
    app = initializeApp(cfg);
    auth = getAuth(app);
    const emu = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST as string | undefined;
    if (emu) connectAuthEmulator(auth, `http://${emu}`, { disableWarnings: true });
  }
  return auth;
}
