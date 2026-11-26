import { beforeEach, describe, expect, it } from 'vitest';
import { resetMemoryDb } from '../server/backend';
import { codePrefix } from '../server/itemCodes';
import { api, ADMIN, STAFF } from './helpers';

beforeEach(() => {
  resetMemoryDb();
});

const create = (name: string, itemCode = '') => api('POST', '/api/admin/items', { itemCode, name }, { token: ADMIN });

describe('automatic item codes', () => {
  it('builds a prefix from the first word of the name', () => {
    expect(codePrefix('Projector 001')).toBe('PROJ');
    expect(codePrefix('[SAMPLE] Folding chair')).toBe('FOLD');
    expect(codePrefix('Kerusi lipat')).toBe('KERU');
    expect(codePrefix('Café table')).toBe('CAFE');
    expect(codePrefix('001')).toBe('ITEM');
    expect(codePrefix('A')).toBe('ITEM');
  });

  it('generates sequential codes when the code is left blank', async () => {
    const a = await create('Projector 001');
    const b = await create('Projector 002');
    const c = await create('Speaker');
    expect(a.status).toBe(201);
    expect([a.data.item.itemCode, b.data.item.itemCode, c.data.item.itemCode]).toEqual(['PROJ-001', 'PROJ-002', 'SPEA-001']);
  });

  it('skips codes that were typed in by hand', async () => {
    await create('Old projector', 'PROJ-001');
    await create('Another', 'PROJ-002');
    const r = await create('Projector new');
    expect(r.data.item.itemCode).toBe('PROJ-003');
  });

  it('still accepts a hand-typed code and rejects duplicates', async () => {
    expect((await create('Camera', 'cam-9')).data.item.itemCode).toBe('CAM-9');
    expect((await create('Camera 2', 'CAM-9')).status).toBe(409);
  });

  it('two staff registering at the same time never get the same code', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => create(`Projector ${i}`)));
    const codes = results.map((r) => r.data.item.itemCode);
    expect(new Set(codes).size).toBe(5);
    expect(codes.sort()).toEqual(['PROJ-001', 'PROJ-002', 'PROJ-003', 'PROJ-004', 'PROJ-005']);
  });

  it('preview shows the next code without reserving it, and is admin-only', async () => {
    await create('Projector');
    const p1 = await api('GET', '/api/admin/next-item-code?name=Projector', undefined, { token: ADMIN });
    const p2 = await api('GET', '/api/admin/next-item-code?name=Projector', undefined, { token: ADMIN });
    expect(p1.data.code).toBe('PROJ-002');
    expect(p2.data.code).toBe('PROJ-002');
    expect((await api('GET', '/api/admin/next-item-code?name=Projector')).status).toBe(401);
    expect((await api('GET', '/api/admin/next-item-code?name=Projector', undefined, { token: STAFF })).status).toBe(403);
  });

  it('editing an item keeps its code unless staff change it', async () => {
    const a = await create('Projector');
    const r = await api('PATCH', `/api/admin/items/${a.data.item.id}`, { name: 'Projector renamed' }, { token: ADMIN });
    expect(r.data.item.itemCode).toBe('PROJ-001');
    expect((await api('PATCH', `/api/admin/items/${a.data.item.id}`, { itemCode: '' }, { token: ADMIN })).status).toBe(400);
  });
});
