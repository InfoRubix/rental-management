/**
 * READ-ONLY Firebase connection check.   npm.cmd run check:firebase
 *
 * - Reports which .env settings are present (never prints secret values).
 * - Connects with the Firebase Admin SDK and performs read-only operations:
 *   reads up to 1 document from `items`, looks for an admin in `users`, lists 1 Auth user, reads the deployed rules.
 * - Checks that Google sign-in is enabled and the web API key works
 *   (read-only; no account is created, nothing is written).
 * It never adds, changes or deletes database records.
 */
export {};

try {
  process.loadEnvFile('.env');
} catch {
  console.log('Note: no .env file found; using environment variables only.');
}

const env = process.env;
let failures = 0;
let serverFailures = 0;
const ok = (m: string) => console.log(`  OK    ${m}`);
const warn = (m: string) => console.log(`  WARN  ${m}`);
const fail = (m: string) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};
const isPlaceholder = (v?: string) => !v || /your-|REPLACE_ME|xxxxx/.test(v);

console.log('\n1. Settings in .env (values hidden)');
if ((env.BACKEND_MODE ?? 'firebase').trim() !== 'firebase') {
  warn(`BACKEND_MODE is "${env.BACKEND_MODE}". The app will NOT use Firebase until you set BACKEND_MODE=firebase.`);
} else ok('BACKEND_MODE=firebase');
for (const k of ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']) {
  if (isPlaceholder(env[k])) {
    serverFailures++;
    fail(`${k} is missing or still a placeholder`);
  } else ok(`${k} is set`);
}
for (const k of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']) {
  isPlaceholder(env[k]) ? fail(`${k} is missing or still a placeholder (needed for Google sign-in in the browser)`) : ok(`${k} is set`);
}
for (const k of Object.keys(env)) {
  if (k.startsWith('VITE_') && /PRIVATE|SECRET|CLIENT_EMAIL|SERVICE_ACCOUNT/i.test(k)) {
    fail(`${k} looks like a server secret with a VITE_ prefix — VITE_ values are sent to browsers. Remove it.`);
  }
}
const pk = env.FIREBASE_PRIVATE_KEY ?? '';
if (!isPlaceholder(pk) && !/BEGIN PRIVATE KEY/.test(pk)) serverFailures++, fail('FIREBASE_PRIVATE_KEY does not look like a private key (should start with -----BEGIN PRIVATE KEY-----)');
if (!isPlaceholder(env.FIREBASE_PROJECT_ID) && !isPlaceholder(env.VITE_FIREBASE_PROJECT_ID)) {
  env.FIREBASE_PROJECT_ID!.trim() === env.VITE_FIREBASE_PROJECT_ID!.trim()
    ? ok('Server and browser use the same project ID')
    : fail('FIREBASE_PROJECT_ID and VITE_FIREBASE_PROJECT_ID are different projects');
}
const ce = env.FIREBASE_CLIENT_EMAIL ?? '';
if (!isPlaceholder(ce) && env.FIREBASE_PROJECT_ID && !ce.includes(`@${env.FIREBASE_PROJECT_ID.trim()}.iam.gserviceaccount.com`)) {
  serverFailures++;
  fail('FIREBASE_CLIENT_EMAIL belongs to a different project than FIREBASE_PROJECT_ID (service-account key from the wrong project?)');
}
if (!env.PUBLIC_BASE_URL || /localhost|127\.0\.0\.1/.test(env.PUBLIC_BASE_URL)) {
  warn('PUBLIC_BASE_URL points to localhost — fine for local testing, but do not print QR labels with it.');
}
if (env.FIRESTORE_EMULATOR_HOST) warn('FIRESTORE_EMULATOR_HOST is set: this check talks to the EMULATOR, not your real database.');

if (serverFailures) {
  console.log(`\n${failures} setting problem(s). Fix the server settings in .env and run this again. (No connection attempted.)\n`);
  process.exit(1);
}
if (failures) console.log('\n(Browser settings are incomplete, but the server settings are complete — testing the database connection anyway.)');

const { getFirebaseAdminApp, firestoreFor, firestoreDatabaseId } = await import('../server/backend');
const { describeFirebaseError } = await import('../server/firebaseErrors');
const explain = (e: unknown) => describeFirebaseError(e)?.message ?? `${(e as Error).name}: ${String((e as Error).message).slice(0, 200)}`;

console.log(`\n2. Firestore (project "${env.FIREBASE_PROJECT_ID}", database "${firestoreDatabaseId()}") — read-only`);
let app;
try {
  ({ app } = await getFirebaseAdminApp());
  ok('Firebase Admin SDK initialised (server-side credentials accepted locally)');
} catch (e) {
  fail(explain(e));
  process.exit(1);
}
const { getFirestore } = await import('firebase-admin/firestore');
const fs = firestoreFor(app, getFirestore);
try {
  const items = await fs.collection('items').limit(1).get();
  ok(`Read from Firestore succeeded (items collection: ${items.empty ? 'empty' : 'has documents'})`);
  const admins = await fs.collection('users').where('role', '==', 'admin').limit(5).get();
  admins.docs.some((d) => d.data().status === 'active')
    ? ok('At least one active admin account exists')
    : warn('No admin yet. Run: npm.cmd run user:make-admin -- your@gmail.com  (registers you as admin), then sign in with Google.');
} catch (e) {
  fail(explain(e));
}

console.log('\n3. Firestore security rules (deployed)');
try {
  const { getSecurityRules } = await import('firebase-admin/security-rules');
  const ruleset = await getSecurityRules(app).getFirestoreRuleset();
  const src = ruleset.source.map((s) => s.content).join('\n');
  if (/allow\s+(read|write|read\s*,\s*write)\s*(:\s*if\s+true|;)/i.test(src)) {
    fail('Deployed rules allow public access! Publish the rules from firestore.rules (deny all).');
  } else if (/if\s+false/.test(src)) ok('Rules deny direct browser access (as intended)');
  else warn('Rules are not the deny-all rules from firestore.rules. Review them in the Console.');
} catch (e) {
  warn(`Could not read deployed rules (${String((e as Error).message).slice(0, 120)}). Check them in the Console.`);
}

console.log('\n4. Firebase Authentication');
try {
  const { getAuth } = await import('firebase-admin/auth');
  await getAuth(app).listUsers(1);
  ok('Admin SDK can access Authentication');
} catch (e) {
  fail(explain(e));
}
if (!env.FIREBASE_AUTH_EMULATOR_HOST) {
  // Read-only: asks Google's admin API whether the Google sign-in provider is switched on.
  try {
    const credential = app.options.credential;
    const token = credential ? (await credential.getAccessToken()).access_token : null;
    if (!token) throw new Error('no access token');
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID!.trim())}/defaultSupportedIdpConfigs/google.com`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const body = (await res.json().catch(() => ({}))) as { enabled?: boolean; error?: { message?: string; status?: string } };
    if (res.ok && body.enabled) ok('Google sign-in is enabled');
    else if (res.ok || res.status === 404 || /NOT_FOUND|CONFIGURATION_NOT_FOUND/.test(body.error?.message ?? ''))
      fail('Google sign-in is NOT enabled. Firebase Console > Authentication > Sign-in method > Add new provider > Google > Enable.');
    else warn(`Could not check the Google sign-in setting (${body.error?.status ?? res.status}). Check it in the Console.`);
  } catch {
    warn('Could not check the Google sign-in setting. Check it in the Console (Authentication > Sign-in method).');
  }
}
if (isPlaceholder(env.VITE_FIREBASE_API_KEY)) {
  warn('VITE_FIREBASE_API_KEY is not set yet, so nobody can sign in from the browser.');
} else if (!env.FIREBASE_AUTH_EMULATOR_HOST) {
  try {
    // Harmless lookup that only tells us whether the web API key belongs to a working project. Creates nothing.
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(env.VITE_FIREBASE_API_KEY!.trim())}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: 'connection-check@example.com', continueUri: 'http://localhost' }),
      },
    );
    const body = (await res.json()) as { error?: { message?: string } };
    const m = body.error?.message ?? '';
    if (/API_KEY_INVALID|API key not valid/.test(m)) fail('VITE_FIREBASE_API_KEY is not valid for this project.');
    else if (/CONFIGURATION_NOT_FOUND/.test(m)) fail('Authentication is not set up yet (Authentication > Get started).');
    else ok('The web API key works');
  } catch {
    warn('Could not reach Firebase Authentication to check the web API key.');
  }
}

console.log(failures ? `\nFinished with ${failures} problem(s).\n` : '\nAll checks passed. Nothing was written to your database.\n');
process.exitCode = failures ? 1 : 0;
