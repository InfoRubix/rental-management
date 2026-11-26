import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMemoryDb } from '../server/backend';
import { HANDOVER_CODE_TTL_MS } from '../server/services/requests';
import { act, ADMIN, api, createItem, STAFF, STAFF2, submitRequest } from './helpers';

beforeEach(() => {
  resetMemoryDb();
});
afterEach(() => {
  vi.useRealTimers();
});

async function newCode(requestId: string) {
  const r = await api('POST', `/api/admin/requests/${requestId}/handover-code`, undefined, { token: ADMIN });
  expect(r.status).toBe(201);
  return r.data as { code: string; expiresAt: string };
}

const redeem = (code: string, token = STAFF) => api('POST', `/api/my/handover/${code}`, undefined, { token });

describe('in-person QR handover', () => {
  it('only admins can create a handover code', async () => {
    const item = await createItem('HO-1');
    const sub = await submitRequest(item.id);
    expect((await api('POST', `/api/admin/requests/${sub.requestId}/handover-code`, undefined, { token: STAFF })).status).toBe(403);
  });

  it('approves and hands over a pending request in one step, recorded under the admin', async () => {
    const item = await createItem('HO-2');
    const sub = await submitRequest(item.id);
    const { code } = await newCode(sub.requestId);

    const preview = await api('GET', `/api/my/handover/${code}`, undefined, { token: STAFF });
    expect(preview.status).toBe(200);
    expect(preview.data.request.reference).toBe(sub.reference);

    const r = await redeem(code);
    expect(r.status).toBe(200);
    expect(r.data.request.status).toBe('On loan');

    const detail = await api('GET', `/api/admin/requests/${sub.requestId}`, undefined, { token: ADMIN });
    expect(detail.data.request.approvedBy.email).toBe('admin@test.local');
    expect(detail.data.request.handoverBy.email).toBe('admin@test.local');
    expect(detail.data.item.status).toBe('On loan');
    expect(detail.data.item.holdRequestId).toBe(sub.requestId);
    expect(detail.data.activity[0].summary).toMatch(/by QR code.*staff@test\.local/);
  });

  it('works for an already approved request', async () => {
    const item = await createItem('HO-3');
    const sub = await submitRequest(item.id);
    await act(sub.requestId, 'approve');
    const { code } = await newCode(sub.requestId);
    expect((await redeem(code)).data.request.status).toBe('On loan');
  });

  it('is single use', async () => {
    const item = await createItem('HO-4');
    const sub = await submitRequest(item.id);
    const { code } = await newCode(sub.requestId);
    expect((await redeem(code)).status).toBe(200);
    expect((await redeem(code)).status).toBe(404);
  });

  it('only the borrower can redeem it', async () => {
    const item = await createItem('HO-5');
    const sub = await submitRequest(item.id);
    const { code } = await newCode(sub.requestId);
    expect((await redeem(code, STAFF2)).status).toBe(403);
    expect((await api('GET', `/api/my/handover/${code}`, undefined, { token: STAFF2 })).status).toBe(403);
    expect((await redeem(code, ADMIN)).status).toBe(403);
    // The real borrower can still use it afterwards.
    expect((await redeem(code)).status).toBe(200);
  });

  it('a new code cancels the previous one', async () => {
    const item = await createItem('HO-6');
    const sub = await submitRequest(item.id);
    const first = await newCode(sub.requestId);
    const second = await newCode(sub.requestId);
    expect((await redeem(first.code)).status).toBe(404);
    expect((await redeem(second.code)).status).toBe(200);
  });

  it('expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const item = await createItem('HO-7');
    const sub = await submitRequest(item.id);
    const { code } = await newCode(sub.requestId);
    vi.setSystemTime(Date.now() + HANDOVER_CODE_TTL_MS + 1000);
    const r = await redeem(code);
    expect(r.status).toBe(410);
    expect(r.data.error.code).toBe('CODE_EXPIRED');
  });

  it('stops working if the request is cancelled', async () => {
    const item = await createItem('HO-8');
    const sub = await submitRequest(item.id);
    const { code } = await newCode(sub.requestId);
    await act(sub.requestId, 'cancel');
    expect((await redeem(code)).status).toBe(409);
  });

  it('cannot be created while another request holds the item', async () => {
    const item = await createItem('HO-9');
    const a = await submitRequest(item.id);
    const b = await submitRequest(item.id, {}, STAFF2);
    await act(a.requestId, 'approve');
    const r = await api('POST', `/api/admin/requests/${b.requestId}/handover-code`, undefined, { token: ADMIN });
    expect(r.status).toBe(409);
  });

  it('rejects malformed codes', async () => {
    expect((await redeem('not-a-code')).status).toBe(404);
    expect((await redeem('A'.repeat(32))).status).toBe(404);
  });

  it('never exposes the code hash in admin request views', async () => {
    const item = await createItem('HO-10');
    const sub = await submitRequest(item.id);
    await newCode(sub.requestId);
    const detail = await api('GET', `/api/admin/requests/${sub.requestId}`, undefined, { token: ADMIN });
    expect(detail.text).not.toMatch(/handoverCodeHash/);
  });
});

describe('return after the admin already closed the loan', () => {
  it('a stale "Request return" press is a harmless no-op, not an error', async () => {
    const item = await createItem('HO-RET');
    const sub = await submitRequest(item.id);
    const { code } = await newCode(sub.requestId);
    await redeem(code);
    // Admin receives the item before the borrower pressed "Request return".
    expect((await act(sub.requestId, 'confirm-return', { condition: 'good' })).status).toBe(200);
    const r = await api('POST', `/api/my/requests/${sub.requestId}/return`, undefined, { token: STAFF });
    expect(r.status).toBe(200);
    expect(r.data.request.status).toBe('Returned');
  });
});
