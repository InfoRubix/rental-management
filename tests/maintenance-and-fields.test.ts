import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetMemoryDb } from '../server/backend';
import type { MemoryDb } from '../server/db/memory';
import { addDays } from '../server/util';
import { ADMIN, api, createItem, itemOnLoan, STAFF, today } from './helpers';

let db: MemoryDb;
beforeEach(() => {
  db = resetMemoryDb();
});

const logMaintenance = (itemId: string, extra: Record<string, unknown> = {}, token = ADMIN) =>
  api(
    'POST',
    `/api/admin/items/${itemId}/maintenance`,
    { date: today(), description: 'Replaced lamp', performedBy: 'AV Services', clientEntryId: randomUUID(), ...extra },
    { token },
  );

describe('extra item fields', () => {
  it('stores the new fields and keeps the staff-only ones off public pages', async () => {
    const item = await createItem('F-001', {
      brand: 'Epson',
      model: 'EB-X51',
      serialNumber: 'SN-SECRET-998',
      location: 'Store room B, shelf 2',
      purchaseDate: '2025-01-15',
      warrantyExpiry: '2027-01-15',
    });
    const staff = await api('GET', `/api/admin/items/${item.id}`, undefined, { token: ADMIN });
    expect(staff.data.item).toMatchObject({ brand: 'Epson', serialNumber: 'SN-SECRET-998', location: 'Store room B, shelf 2' });

    for (const r of [await api('GET', `/api/items/${item.id}`, undefined, { token: STAFF }), await api('GET', '/api/items', undefined, { token: STAFF })]) {
      expect(r.text).toContain('Epson'); // brand and model are public
      expect(r.text).not.toContain('SN-SECRET-998');
      expect(r.text).not.toContain('Store room B');
      expect(r.text).not.toContain('2027-01-15');
      expect(r.text).not.toContain('2025-01-15');
    }
  });

  it('a partial edit does not blank fields that were not sent (regression)', async () => {
    const item = await createItem('F-002', { description: 'Keep me', serialNumber: 'SN-1', conditionNotes: 'Keep notes' });
    const r = await api('PATCH', `/api/admin/items/${item.id}`, { name: 'Renamed' }, { token: ADMIN });
    expect(r.status).toBe(200);
    expect(r.data.item).toMatchObject({ name: 'Renamed', description: 'Keep me', serialNumber: 'SN-1', conditionNotes: 'Keep notes' });
  });

  it('rejects invalid dates', async () => {
    const r = await api('POST', '/api/admin/items', { itemCode: 'F-003', name: 'X', warrantyExpiry: '2026-13-45' }, { token: ADMIN });
    expect(r.status).toBe(400);
    expect(r.data.error.fields.warrantyExpiry).toBeDefined();
  });
});

describe('maintenance log', () => {
  it('requires an admin', async () => {
    const item = await createItem();
    expect((await api('POST', `/api/admin/items/${item.id}/maintenance`, {})).status).toBe(401);
    expect((await logMaintenance(item.id, {}, STAFF)).status).toBe(403);
  });

  it('records an entry with who and when, shown in the item detail', async () => {
    const item = await createItem();
    const r = await logMaintenance(item.id);
    expect(r.status).toBe(200);
    expect(r.data.entry).toMatchObject({ description: 'Replaced lamp', performedBy: 'AV Services', statusChange: null });
    expect(r.data.entry.createdBy.email).toBe('admin@test.local');
    const detail = await api('GET', `/api/admin/items/${item.id}`, undefined, { token: ADMIN });
    expect(detail.data.maintenance).toHaveLength(1);
    expect(detail.data.activity.some((a: { action: string }) => a.action === 'item.maintenance-logged')).toBe(true);
  });

  it('a double-submitted form creates one entry and one activity record', async () => {
    const item = await createItem();
    const clientEntryId = randomUUID();
    const [a, b] = await Promise.all([logMaintenance(item.id, { clientEntryId }), logMaintenance(item.id, { clientEntryId })]);
    expect([a.data.alreadyDone, b.data.alreadyDone].sort()).toEqual([false, true]);
    expect(db.countDocs('maintenanceLogs')).toBe(1);
    const acts = await db.query('activity', { filters: [{ field: 'action', op: '==', value: 'item.maintenance-logged' }] });
    expect(acts).toHaveLength(1);
  });

  it('can finish maintenance and make the item Available in one step', async () => {
    const item = await createItem();
    await api('POST', `/api/admin/items/${item.id}/status`, { status: 'Under maintenance' }, { token: ADMIN });
    const r = await logMaintenance(item.id, { markAvailable: true });
    expect(r.status).toBe(200);
    expect(r.data.item.status).toBe('Available');
    expect(r.data.entry.statusChange).toEqual({ from: 'Under maintenance', to: 'Available' });
  });

  it('cannot use "mark available" on items that are not under maintenance (e.g. on loan)', async () => {
    const loan = await itemOnLoan();
    const r = await logMaintenance(loan.item.id, { markAvailable: true });
    expect(r.status).toBe(409);
    const item = await api('GET', `/api/admin/items/${loan.item.id}`, undefined, { token: ADMIN });
    expect(item.data.item.status).toBe('On loan');
    expect(db.countDocs('maintenanceLogs')).toBe(0); // failed transaction wrote nothing
  });

  it('rejects future dates and empty descriptions', async () => {
    const item = await createItem();
    expect((await logMaintenance(item.id, { date: addDays(today(), 1) })).status).toBe(400);
    expect((await logMaintenance(item.id, { description: '' })).status).toBe(400);
  });

  it('maintenance details never appear on public pages', async () => {
    const item = await createItem();
    await logMaintenance(item.id, { description: 'PRIVATE-REPAIR-NOTE', performedBy: 'PRIVATE-VENDOR' });
    for (const r of [await api('GET', `/api/items/${item.id}`, undefined, { token: STAFF }), await api('GET', '/api/items', undefined, { token: STAFF })]) {
      expect(r.text).not.toContain('PRIVATE-REPAIR-NOTE');
      expect(r.text).not.toContain('PRIVATE-VENDOR');
    }
  });
});
