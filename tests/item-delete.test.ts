import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetMemoryDb } from '../server/backend';
import type { MemoryDb } from '../server/db/memory';
import { act, ADMIN, api, createItem, STAFF, submitRequest, today } from './helpers';

let db: MemoryDb;
beforeEach(() => {
  db = resetMemoryDb();
});

const del = (id: string, confirmItemCode: string, token = ADMIN) =>
  api('POST', `/api/admin/items/${id}/delete`, { confirmItemCode }, { token });

describe('permanent item delete', () => {
  it('deletes an item with no history, frees its code and keeps an activity record', async () => {
    const item = await createItem('DEL-001');
    const detail = await api('GET', `/api/admin/items/${item.id}`, undefined, { token: ADMIN });
    expect(detail.data.cannotDeleteReason).toBeNull();

    const r = await del(item.id, 'del-001');
    expect(r.status).toBe(200);
    expect((await api('GET', `/api/admin/items/${item.id}`, undefined, { token: ADMIN })).status).toBe(404);
    expect((await api('GET', `/api/items/${item.id}`, undefined, { token: STAFF })).status).toBe(404);
    // The code can be used again.
    expect((await api('POST', '/api/admin/items', { itemCode: 'DEL-001', name: 'New' }, { token: ADMIN })).status).toBe(201);
    const acts = await db.query('activity', { filters: [{ field: 'action', op: '==', value: 'item.deleted' }] });
    expect(acts).toHaveLength(1);
  });

  it('requires typing the exact item code', async () => {
    const item = await createItem('DEL-002');
    const r = await del(item.id, 'DEL-00');
    expect(r.status).toBe(400);
    expect(r.data.error.code).toBe('CONFIRMATION_MISMATCH');
    expect(db.countDocs('items')).toBe(1);
  });

  it('refuses items with borrowing history (even rejected requests)', async () => {
    const item = await createItem('DEL-003');
    const sub = await submitRequest(item.id);
    await act(sub.requestId, 'reject');
    const detail = await api('GET', `/api/admin/items/${item.id}`, undefined, { token: ADMIN });
    expect(detail.data.cannotDeleteReason).toMatch(/history/);
    const r = await del(item.id, 'DEL-003');
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('HAS_HISTORY');
    expect(db.countDocs('items')).toBe(1);
  });

  it('refuses items with maintenance records', async () => {
    const item = await createItem('DEL-004');
    await api(
      'POST',
      `/api/admin/items/${item.id}/maintenance`,
      { date: today(), description: 'Checked', clientEntryId: randomUUID() },
      { token: ADMIN },
    );
    expect((await del(item.id, 'DEL-004')).status).toBe(409);
  });

  it('is admin-only', async () => {
    const item = await createItem('DEL-005');
    expect((await api('POST', `/api/admin/items/${item.id}/delete`, { confirmItemCode: 'DEL-005' })).status).toBe(401);
    expect((await del(item.id, 'DEL-005', STAFF)).status).toBe(403);
    expect(db.countDocs('items')).toBe(1);
  });

  it('deleting twice is harmless', async () => {
    const item = await createItem('DEL-006');
    await del(item.id, 'DEL-006');
    expect((await del(item.id, 'DEL-006')).status).toBe(404);
  });
});
