/**
 * Manage user accounts from the command line (mainly to create the FIRST admin).
 * Everyone signs in with Google; the account appears here after their first sign-in.
 *
 *   npm.cmd run user:make-admin -- person@gmail.com
 *   npm.cmd run user:make-staff -- person@gmail.com
 *   npm.cmd run user:block      -- person@gmail.com
 *   npm.cmd run user:unblock    -- person@gmail.com
 *   npm.cmd run user:list
 *
 * Reads the server credentials from .env. Never prints secrets.
 */
export {};

try {
  process.loadEnvFile('.env');
} catch {
  /* .env is optional if variables are already set */
}

const { getFirebaseAdminApp, firestoreFor } = await import('../server/backend');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore } = await import('firebase-admin/firestore');

const [command, emailArg] = process.argv.slice(2);

async function main() {
  const { app, projectId, usingEmulator } = await getFirebaseAdminApp();
  const auth = getAuth(app);
  const fs = firestoreFor(app, getFirestore);
  console.log(`Firebase project: ${projectId}${usingEmulator ? ' (EMULATOR)' : ''}`);

  if (command === 'list') {
    const snap = await fs.collection('users').get();
    if (snap.empty) console.log('No accounts yet. Sign in with Google on the website first.');
    for (const d of snap.docs) {
      const u = d.data();
      console.log(`${String(u.role).padEnd(6)} ${String(u.status).padEnd(8)} ${u.email ?? '(no email)'}  ${u.name ?? ''}`);
    }
    return;
  }

  const email = emailArg?.trim().toLowerCase();
  const changes: Record<string, { role?: string; status?: string }> = {
    'make-admin': { role: 'admin', status: 'active' },
    'make-staff': { role: 'staff' },
    block: { status: 'blocked' },
    unblock: { status: 'active' },
  };
  const change = command ? changes[command] : undefined;
  if (!change || !email || !email.includes('@')) {
    console.error('Usage: npm.cmd run user:make-admin -- person@gmail.com   (also user:make-staff, user:block, user:unblock, user:list)');
    process.exitCode = 1;
    return;
  }

  let authUser;
  try {
    authUser = await auth.getUserByEmail(email);
  } catch {
    authUser = null;
  }
  const hasAccount = authUser ? (await fs.collection('users').doc(authUser.uid).get()).exists : false;
  if (!hasAccount && (command === 'make-admin' || command === 'make-staff')) {
    // Only registered emails can sign in, so register this one; the account is created at their first sign-in.
    const role = command === 'make-admin' ? 'admin' : 'staff';
    await fs.collection('userInvites').doc(email).set({
      email,
      role,
      invitedAt: new Date().toISOString(),
      invitedBy: { type: 'system', name: 'Command line (users script)' },
    });
    console.log(`${email}: registered as ${role}. They can now sign in with Google; the account is created at their first sign-in.`);
    return;
  }
  if (!authUser) {
    console.error(`No account found for ${email}.`);
    process.exitCode = 1;
    return;
  }

  const ref = fs.collection('users').doc(authUser.uid);
  const now = new Date().toISOString();
  const existing = await ref.get();
  if (!existing.exists) {
    // Normally created at first sign-in; create it here if the person never opened the app.
    await ref.set({
      email,
      name: authUser.displayName ?? null,
      photoUrl: authUser.photoURL ?? null,
      role: 'staff',
      status: 'active',
      createdAt: now,
      lastSeenAt: null,
      updatedAt: now,
      updatedBy: null,
    });
  }
  await ref.set(
    { ...change, updatedAt: now, updatedBy: { type: 'system', name: 'Command line (users script)' } },
    { merge: true },
  );
  if (change.status === 'blocked') await auth.revokeRefreshTokens(authUser.uid);
  const after = (await ref.get()).data()!;
  console.log(`${email}: role=${after.role}, status=${after.status}`);
}

main().catch((err) => {
  console.error('Failed:', (err as Error).message);
  process.exitCode = 1;
});
