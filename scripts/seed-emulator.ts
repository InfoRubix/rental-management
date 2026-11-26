/**
 * Adds clearly labelled "[SAMPLE]" items to the LOCAL Firestore EMULATOR only.
 * Refuses to run against a real Firebase project.
 *
 *   npm.cmd run seed:emulator
 */
try {
  process.loadEnvFile('.env');
} catch {
  /* optional */
}

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set. Sample data is only allowed in the local emulator.');
  process.exit(1);
}
if (!process.env.FIREBASE_PROJECT_ID?.startsWith('demo-')) {
  console.error('Refusing to run: FIREBASE_PROJECT_ID must start with "demo-" when seeding (e.g. demo-rental-management).');
  process.exit(1);
}

const { getFirebaseAdminApp, firestoreFor } = await import('../server/backend');
const { getFirestore } = await import('firebase-admin/firestore');
const { FirestoreDb } = await import('../server/db/firestore');
const { seedSampleItems } = await import('../server/devSeed');
const { getConfig } = await import('../server/config');

const { app } = await getFirebaseAdminApp();
const result = await seedSampleItems(new FirestoreDb(firestoreFor(app, getFirestore)), getConfig());
console.log(`Sample items created: ${result.created}, already present: ${result.skipped}`);

export {};
