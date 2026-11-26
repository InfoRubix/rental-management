import type { ServerConfig } from './config';
import type { Db } from './db/types';
import { C } from './model';
import { createItem } from './services/items';

/**
 * SAMPLE DATA — development only. Every record is named "[SAMPLE] …" and flagged `sample: true`.
 * Called only by an explicit action: the "Load sample items" button in memory mode,
 * or `npm run seed:emulator` against the local Firestore emulator. Never runs automatically.
 */
export const SAMPLE_ITEMS = [
  { itemCode: 'SAMPLE-PROJ-001', name: '[SAMPLE] Projector 001', category: 'Audio visual', description: 'Sample record for testing. Portable projector with HDMI cable.' },
  { itemCode: 'SAMPLE-PROJ-002', name: '[SAMPLE] Projector 002', category: 'Audio visual', description: 'Sample record for testing. Same model as Projector 001 — a separate physical unit.' },
  { itemCode: 'SAMPLE-CHAIR-001', name: '[SAMPLE] Folding chair 001', category: 'Furniture', description: 'Sample record for testing.' },
  { itemCode: 'SAMPLE-SPK-001', name: '[SAMPLE] Bluetooth speaker 001', category: 'Audio visual', description: 'Sample record for testing.' },
];

export async function seedSampleItems(db: Db, _config: ServerConfig) {
  let created = 0;
  let skipped = 0;
  for (const s of SAMPLE_ITEMS) {
    if (await db.get(C.itemCodes, s.itemCode)) {
      skipped++;
      continue;
    }
    await createItem(
      db,
      { type: 'system', name: 'Sample data loader' },
      {
        ...s,
        conditionNotes: 'Sample record — staff-only condition notes appear here.',
        externalImageUrl: '',
        brand: '',
        model: '',
        serialNumber: '',
        location: '',
        purchaseDate: '',
        warrantyExpiry: '',
      },
      { sample: true },
    );
    created++;
  }
  return { created, skipped };
}
