import { beforeEach, describe, expect, it } from 'vitest';
import { resetMemoryDb } from '../server/backend';
import { getConfig } from '../server/config';
import type { MemoryDb } from '../server/db/memory';
import { handleApi } from '../server/handler';
import { addDays } from '../server/util';
import {
  act,
  ADMIN,
  api,
  createItem,
  google,
  itemOnLoan,
  NOT_LISTED,
  requestBody,
  STAFF,
  STAFF2,
  submitRequest,
  today,
} from './helpers';

/** Admin registers an email (role defaults to staff). */
const register = (email: string, role: 'staff' | 'admin' = 'staff') =>
  api('POST', '/api/admin/users', { email, role }, { token: ADMIN });

/** Registers the email, signs in once with Google, optionally completes the profile. Returns the token. */
async function registeredGoogle(uid: string, email: string, withProfile = false) {
  await register(email);
  const t = google(uid, email);
  await api('GET', '/api/me', undefined, { token: t });
  if (withProfile) {
    await api('PUT', '/api/my/profile', { fullName: 'Test Person', phone: '0123456789', department: 'SANCO' }, { token: t });
  }
  return t;
}

let db: MemoryDb;
beforeEach(() => {
  db = resetMemoryDb();
});

const adminEndpoints: Array<[string, string, unknown?]> = [
  ['GET', '/api/admin/summary'],
  ['GET', '/api/admin/items'],
  ['POST', '/api/admin/items', { itemCode: 'X-1', name: 'x' }],
  ['GET', '/api/admin/requests'],
  ['POST', '/api/admin/requests/abc/actions', { action: 'approve' }],
  ['GET', '/api/admin/activity'],
  ['GET', '/api/admin/users'],
  ['PATCH', '/api/admin/users/abc', { role: 'admin' }],
  ['POST', '/api/admin/dev/seed'],
];
const userEndpoints: Array<[string, string, unknown?]> = [
  ['GET', '/api/items'],
  ['GET', '/api/items/abc'],
  ['POST', '/api/requests', {}],
  ['GET', '/api/my/requests'],
  ['GET', '/api/me'],
];

describe('sign-in and permissions', () => {
  it.each([...adminEndpoints, ...userEndpoints])('%s %s requires sign-in (401)', async (method, path, body) => {
    expect((await api(method, path, body)).status).toBe(401);
  });

  it.each(adminEndpoints)('%s %s is refused for normal staff (403)', async (method, path, body) => {
    expect((await api(method, path, body, { token: STAFF })).status).toBe(403);
  });

  it('test accounts not listed in DEV_ADMIN_EMAILS / DEV_STAFF_EMAILS are refused', async () => {
    expect((await api('GET', '/api/me', undefined, { token: NOT_LISTED })).status).toBe(403);
  });

  it('rejects malformed tokens', async () => {
    expect((await api('GET', '/api/me', undefined, { token: 'garbage' })).status).toBe(401);
  });

  it('reports the role of the signed-in person', async () => {
    expect((await api('GET', '/api/me', undefined, { token: ADMIN })).data.me).toMatchObject({ role: 'admin', status: 'active' });
    expect((await api('GET', '/api/me', undefined, { token: STAFF })).data.me).toMatchObject({ role: 'staff', status: 'active' });
  });
});

describe('Google accounts (admin registers people; no self sign-up)', () => {
  it('an unregistered Google account is refused and nothing is stored', async () => {
    const t = google('uid-stranger', 'stranger@gmail.com');
    const r = await api('GET', '/api/me', undefined, { token: t });
    expect(r.status).toBe(403);
    expect(r.data.error.code).toBe('NOT_REGISTERED');
    expect(db.countDocs('users')).toBe(0);
    expect((await api('GET', '/api/items', undefined, { token: t })).status).toBe(403);
  });

  it('a registered email becomes an active account with the chosen role at first sign-in', async () => {
    expect((await register('Alice@Gmail.com')).status).toBe(201);
    const list = await api('GET', '/api/admin/users', undefined, { token: ADMIN });
    expect(list.data.invites.map((i: { email: string }) => i.email)).toEqual(['alice@gmail.com']);

    const t = google('uid-alice', 'Alice@Gmail.com');
    const me = await api('GET', '/api/me', undefined, { token: t });
    expect(me.data.me).toMatchObject({ uid: 'uid-alice', email: 'alice@gmail.com', role: 'staff', status: 'active', profileComplete: false });
    // The invite is used up and the account is listed.
    const after = await api('GET', '/api/admin/users', undefined, { token: ADMIN });
    expect(after.data.invites).toEqual([]);
    expect(after.data.users.map((u: { email: string }) => u.email)).toContain('alice@gmail.com');
    // Signing in again does not create a duplicate account.
    await api('GET', '/api/me', undefined, { token: t });
    expect(db.countDocs('users')).toBe(1);
  });

  it('an admin can register someone directly as admin', async () => {
    await register('boss@company.com', 'admin');
    const t = google('uid-boss', 'boss@company.com');
    expect((await api('GET', '/api/admin/summary', undefined, { token: t })).status).toBe(200);
  });

  it('only admins can register people, and emails cannot be registered twice', async () => {
    expect((await api('POST', '/api/admin/users', { email: 'x@gmail.com' }, { token: STAFF })).status).toBe(403);
    expect((await register('x@gmail.com')).status).toBe(201);
    expect((await register('X@gmail.com')).data.error.code).toBe('ALREADY_INVITED');
    await api('GET', '/api/me', undefined, { token: google('uid-x', 'x@gmail.com') });
    expect((await register('x@gmail.com')).data.error.code).toBe('ALREADY_REGISTERED');
    expect((await register('not-an-email')).status).toBe(400);
  });

  it('removing a registration before first sign-in stops that person signing in', async () => {
    await register('late@gmail.com');
    expect((await api('DELETE', '/api/admin/invites/late%40gmail.com', undefined, { token: ADMIN })).status).toBe(200);
    expect((await api('GET', '/api/me', undefined, { token: google('uid-late', 'late@gmail.com') })).data.error.code).toBe(
      'NOT_REGISTERED',
    );
  });

  it('only Google sign-in is accepted', async () => {
    const r = await api('GET', '/api/me', undefined, { token: 'password-test:uid-bob:bob@example.com' });
    expect(r.status).toBe(403);
    expect(r.data.error.code).toBe('GOOGLE_REQUIRED');
    expect(db.countDocs('users')).toBe(0);
  });

  it('an admin can block an account; blocked accounts can do nothing', async () => {
    const t = await registeredGoogle('uid-dave', 'dave@gmail.com');
    const r = await api('PATCH', '/api/admin/users/uid-dave', { status: 'blocked' }, { token: ADMIN });
    expect(r.status).toBe(200);
    const items = await api('GET', '/api/items', undefined, { token: t });
    expect(items.status).toBe(403);
    expect(items.data.error.code).toBe('ACCOUNT_BLOCKED');
    expect((await api('GET', '/api/me', undefined, { token: t })).data.me.status).toBe('blocked');
  });

  it('an admin can promote a Google account to admin', async () => {
    const t = await registeredGoogle('uid-erin', 'erin@gmail.com');
    await api('PATCH', '/api/admin/users/uid-erin', { role: 'admin' }, { token: ADMIN });
    expect((await api('GET', '/api/admin/summary', undefined, { token: t })).status).toBe(200);
  });

  it('the last active admin cannot be demoted or blocked', async () => {
    const t = await registeredGoogle('uid-fay', 'fay@gmail.com');
    await api('PATCH', '/api/admin/users/uid-fay', { role: 'admin' }, { token: ADMIN });
    // Fay is the only admin stored in the database (test admins are not stored).
    const demote = await api('PATCH', '/api/admin/users/uid-fay', { role: 'staff' }, { token: t });
    expect(demote.status).toBe(409);
    expect(demote.data.error.code).toBe('LAST_ADMIN');
    expect((await api('PATCH', '/api/admin/users/uid-fay', { status: 'blocked' }, { token: ADMIN })).status).toBe(409);
  });
});

describe('staff profile', () => {
  const PROFILE = { fullName: 'Nur Aisyah', phone: '+60 12-345 6789', department: 'Ana Travel' };

  it('saves full name, phone and department; email stays the registered one', async () => {
    const t = await registeredGoogle('uid-ais', 'aisyah@gmail.com');
    const r = await api('PUT', '/api/my/profile', { ...PROFILE, email: 'hacker@evil.com' }, { token: t });
    expect(r.status).toBe(200);
    expect(r.data.profileComplete).toBe(true);
    const me = (await api('GET', '/api/me', undefined, { token: t })).data.me;
    expect(me.email).toBe('aisyah@gmail.com');
    expect(me.profile).toEqual(PROFILE);
    const users = await api('GET', '/api/admin/users', undefined, { token: ADMIN });
    expect(users.data.users.find((u: { uid: string }) => u.uid === 'uid-ais').profile).toEqual(PROFILE);
  });

  it('only accepts the listed departments and a valid phone', async () => {
    const t = await registeredGoogle('uid-p2', 'p2@gmail.com');
    const bad = await api('PUT', '/api/my/profile', { ...PROFILE, department: 'Marketing', phone: 'abc' }, { token: t });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.data.error.fields).sort()).toEqual(['department', 'phone']);
    expect((await api('PUT', '/api/my/profile', { ...PROFILE, fullName: '' }, { token: t })).status).toBe(400);
  });

  it('staff must complete the profile before requesting, and requests use the profile', async () => {
    const item = await createItem('PRF-1');
    const t = await registeredGoogle('uid-p3', 'p3@gmail.com');
    const early = await api('POST', '/api/requests', requestBody(item.id), { token: t });
    expect(early.status).toBe(409);
    expect(early.data.error.code).toBe('PROFILE_INCOMPLETE');

    await api('PUT', '/api/my/profile', PROFILE, { token: t });
    const sub = await api('POST', '/api/requests', requestBody(item.id, { department: 'typed something else', phone: '' }), { token: t });
    expect(sub.status).toBe(201);
    const detail = await api('GET', `/api/admin/requests/${sub.data.requestId}`, undefined, { token: ADMIN });
    expect(detail.data.request).toMatchObject({ customerName: 'Nur Aisyah', department: 'Ana Travel', phone: '+60 12-345 6789' });
  });
});

describe('borrower privacy', () => {
  it('staff see only their own requests', async () => {
    const item1 = await createItem('A-001');
    const item2 = await createItem('A-002');
    const mine = await submitRequest(item1.id, {}, STAFF);
    const theirs = await submitRequest(item2.id, { department: 'Other dept' }, STAFF2);

    const list = await api('GET', '/api/my/requests', undefined, { token: STAFF });
    expect(list.data.requests.map((r: { reference: string }) => r.reference)).toEqual([mine.reference]);
    expect(list.text).not.toContain('Other dept');

    expect((await api('GET', `/api/my/requests/${theirs.requestId}`, undefined, { token: STAFF })).status).toBe(404);
    expect((await api('POST', `/api/my/requests/${theirs.requestId}/cancel`, undefined, { token: STAFF })).status).toBe(404);
    expect((await api('GET', `/api/admin/requests/${theirs.requestId}`, undefined, { token: STAFF })).status).toBe(403);
  });

  it('private admin notes and condition notes never appear in staff responses', async () => {
    const SECRET = 'SECRET-ADMIN-NOTE-123';
    const item = await createItem('N-001', { conditionNotes: `${SECRET} scratched lens`, serialNumber: 'SN-SECRET' });
    const sub = await submitRequest(item.id);
    await api('PATCH', `/api/admin/requests/${sub.requestId}`, { staffNotes: SECRET }, { token: ADMIN });
    await act(sub.requestId, 'approve', { note: SECRET });
    await act(sub.requestId, 'handover', { note: SECRET });

    const responses = [
      await api('GET', '/api/items', undefined, { token: STAFF }),
      await api('GET', `/api/items/${item.id}`, undefined, { token: STAFF }),
      await api('GET', '/api/my/requests', undefined, { token: STAFF }),
      await api('GET', `/api/my/requests/${sub.requestId}`, undefined, { token: STAFF }),
      await api('POST', `/api/my/requests/${sub.requestId}/return`, undefined, { token: STAFF }),
    ];
    for (const r of responses) {
      expect(r.status).toBe(200);
      expect(r.text).not.toContain(SECRET);
      expect(r.text).not.toContain('SN-SECRET');
      expect(r.text).not.toContain('admin@test.local');
      expect(r.text).not.toContain('staffNotes');
      expect(r.text).not.toContain('conditionNotes');
    }
  });

  it('the item page never reveals who is borrowing it', async () => {
    const loan = await itemOnLoan();
    const r = await api('GET', `/api/items/${loan.item.id}`, undefined, { token: STAFF2 });
    expect(r.data.item.status).toBe('On loan');
    expect(r.text).not.toContain('staff@test.local');
    expect(r.text).not.toContain('Finance');
    expect(r.text).not.toContain('6789');
    expect(r.text).not.toContain(loan.reference);
    expect(r.text).not.toContain('holdRequestId');
  });

  it('requests take the name and email from the account, not the form', async () => {
    const item = await createItem();
    const sub = await submitRequest(item.id, { customerName: 'Fake Name', email: 'fake@evil.example' });
    const detail = await api('GET', `/api/admin/requests/${sub.requestId}`, undefined, { token: ADMIN });
    expect(detail.data.request).toMatchObject({ email: 'staff@test.local', department: 'Finance, KL branch', borrowerUid: 'local-test-staff@test.local' });
    expect(detail.text).not.toContain('fake@evil.example');
  });
});

describe('status transitions', () => {
  it('runs the full happy path and only marks On loan after handover', async () => {
    const item = await createItem();
    const sub = await submitRequest(item.id);
    const approved = await act(sub.requestId, 'approve');
    expect(approved.data.request.status).toBe('Approved');
    expect(approved.data.item.status).toBe('Available'); // approval is NOT handover
    expect((await api('GET', `/api/items/${item.id}`, undefined, { token: STAFF2 })).data.item.availability.canRequest).toBe(false);

    const handed = await act(sub.requestId, 'handover');
    expect(handed.data.request.status).toBe('On loan');
    expect(handed.data.request.handoverBy.email).toBe('admin@test.local');
    expect(handed.data.item.status).toBe('On loan');
  });

  it('rejects invalid transitions', async () => {
    const item = await createItem();
    const sub = await submitRequest(item.id);
    expect((await act(sub.requestId, 'handover')).status).toBe(409);
    expect((await act(sub.requestId, 'confirm-return', { condition: 'good' })).status).toBe(409);
    expect((await api('POST', `/api/my/requests/${sub.requestId}/return`, undefined, { token: STAFF })).status).toBe(409);
    await act(sub.requestId, 'reject');
    expect((await act(sub.requestId, 'approve')).status).toBe(409);
    expect((await act(sub.requestId, 'handover')).status).toBe(409);
  });

  it('cannot manually set an item to On loan', async () => {
    const item = await createItem();
    expect((await api('POST', `/api/admin/items/${item.id}/status`, { status: 'On loan' }, { token: ADMIN })).status).toBe(400);
  });

  it('cannot deactivate or put into maintenance an item with an active loan', async () => {
    const loan = await itemOnLoan();
    for (const status of ['Inactive', 'Under maintenance', 'Available']) {
      expect((await api('POST', `/api/admin/items/${loan.item.id}/status`, { status }, { token: ADMIN })).status).toBe(409);
    }
  });

  it('cannot deactivate an item with a pending request; keeps history when deactivated', async () => {
    const item = await createItem();
    const sub = await submitRequest(item.id);
    expect((await api('POST', `/api/admin/items/${item.id}/status`, { status: 'Inactive' }, { token: ADMIN })).status).toBe(409);
    await act(sub.requestId, 'reject');
    expect((await api('POST', `/api/admin/items/${item.id}/status`, { status: 'Inactive' }, { token: ADMIN })).status).toBe(200);
    const detail = await api('GET', `/api/admin/items/${item.id}`, undefined, { token: ADMIN });
    expect(detail.data.history).toHaveLength(1);
    expect((await api('GET', '/api/items', undefined, { token: STAFF })).data.items).toHaveLength(0);
    expect((await api('POST', '/api/requests', requestBody(item.id), { token: STAFF })).status).toBe(404);
  });

  it('only one request can hold an item at a time', async () => {
    const item = await createItem();
    const a = await submitRequest(item.id, {}, STAFF);
    const b = await submitRequest(item.id, {}, STAFF2);
    expect((await act(a.requestId, 'approve')).status).toBe(200);
    expect((await act(b.requestId, 'approve')).status).toBe(409);
    const third = await registeredGoogle('u1', 'x@gmail.com', true);
    expect((await api('POST', '/api/requests', requestBody(item.id), { token: third })).status).toBe(409);
  });

  it('a handover cannot happen twice', async () => {
    const loan = await itemOnLoan();
    await act(loan.requestId, 'confirm-return', { condition: 'good' });
    expect((await act(loan.requestId, 'handover')).data.alreadyDone).toBe(true);
    expect((await api('GET', `/api/admin/items/${loan.item.id}`, undefined, { token: ADMIN })).data.item.status).toBe('Available');
  });
});

describe('returns', () => {
  it('a return request does not make the item available until an admin confirms receipt', async () => {
    const loan = await itemOnLoan();
    const r = await api('POST', `/api/my/requests/${loan.requestId}/return`, undefined, { token: STAFF });
    expect(r.data.request.status).toBe('Return requested');
    const pub = await api('GET', `/api/items/${loan.item.id}`, undefined, { token: STAFF2 });
    expect(pub.data.item.status).toBe('On loan');
    expect(pub.data.item.availability.canRequest).toBe(false);
    const confirmed = await act(loan.requestId, 'confirm-return', { condition: 'good' });
    expect(confirmed.data.request.status).toBe('Returned');
    expect(confirmed.data.item.status).toBe('Available');
  });

  it('only the borrower can request the return of their loan', async () => {
    const loan = await itemOnLoan();
    expect((await api('POST', `/api/my/requests/${loan.requestId}/return`, undefined, { token: STAFF2 })).status).toBe(404);
  });

  it('admins can confirm a return directly and send the item to maintenance', async () => {
    const loan = await itemOnLoan();
    expect((await act(loan.requestId, 'confirm-return')).status).toBe(400);
    const r = await act(loan.requestId, 'confirm-return', { condition: 'needs-maintenance', conditionNotes: 'Lamp flickers' });
    expect(r.data.item.status).toBe('Under maintenance');
    expect(r.data.item.conditionNotes).toContain('Lamp flickers');
  });

  it('the item QR can be reused for a new loan after return', async () => {
    const loan = await itemOnLoan();
    await act(loan.requestId, 'confirm-return', { condition: 'good' });
    const next = await submitRequest(loan.item.id, {}, STAFF2);
    expect(next.reference).not.toBe(loan.reference);
  });

  it('a borrower can cancel their own pending request', async () => {
    const item = await createItem();
    const sub = await submitRequest(item.id);
    const r = await api('POST', `/api/my/requests/${sub.requestId}/cancel`, undefined, { token: STAFF });
    expect(r.data.request.status).toBe('Cancelled');
  });
});

describe('duplicate and concurrent actions', () => {
  it('re-submitting the same form does not create a second request', async () => {
    const item = await createItem();
    const body = requestBody(item.id);
    const [r1, r2] = await Promise.all([
      api('POST', '/api/requests', body, { token: STAFF }),
      api('POST', '/api/requests', body, { token: STAFF }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(db.countDocs('requests')).toBe(1);
  });

  it('another person reusing the same form ID gets their own request, not someone else\'s', async () => {
    const item1 = await createItem('B-1');
    const item2 = await createItem('B-2');
    const body = requestBody(item1.id);
    await api('POST', '/api/requests', body, { token: STAFF });
    const r = await api('POST', '/api/requests', { ...body, itemId: item2.id }, { token: STAFF2 });
    expect(r.status).toBe(201);
    expect(r.data.duplicate).toBe(false);
  });

  it('blocks a second open request for the same item from the same person', async () => {
    const item = await createItem();
    await submitRequest(item.id);
    const r = await api('POST', '/api/requests', requestBody(item.id), { token: STAFF });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('ALREADY_REQUESTED');
  });

  it('concurrent handovers by two admins result in exactly one handover', async () => {
    const item = await createItem();
    const sub = await submitRequest(item.id);
    await act(sub.requestId, 'approve');
    const results = await Promise.all([act(sub.requestId, 'handover'), act(sub.requestId, 'handover'), act(sub.requestId, 'handover')]);
    expect(results.filter((r) => r.data.alreadyDone === false)).toHaveLength(1);
    const activity = await db.query('activity', { filters: [{ field: 'action', op: '==', value: 'request.handover' }] });
    expect(activity).toHaveLength(1);
  });

  it('repeated return requests and confirmations do not duplicate activity', async () => {
    const loan = await itemOnLoan();
    const ret = () => api('POST', `/api/my/requests/${loan.requestId}/return`, undefined, { token: STAFF });
    await Promise.all([ret(), ret()]);
    await Promise.all([
      act(loan.requestId, 'confirm-return', { condition: 'good' }),
      act(loan.requestId, 'confirm-return', { condition: 'good' }),
    ]);
    const a = await db.query('activity', { filters: [{ field: 'action', op: '==', value: 'request.return-requested' }] });
    const b = await db.query('activity', { filters: [{ field: 'action', op: '==', value: 'request.confirm-return' }] });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('concurrent approvals of two different requests for one item: only one succeeds', async () => {
    const item = await createItem();
    const a = await submitRequest(item.id, {}, STAFF);
    const b = await submitRequest(item.id, {}, STAFF2);
    const [ra, rb] = await Promise.all([act(a.requestId, 'approve'), act(b.requestId, 'approve')]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
  });
});

describe('validation and abuse protection', () => {
  it('validates request input on the server', async () => {
    const item = await createItem();
    const r = await api('POST', '/api/requests', requestBody(item.id, { department: '', phone: 'abc' }), { token: STAFF });
    expect(r.status).toBe(400);
    expect(Object.keys(r.data.error.fields)).toEqual(expect.arrayContaining(['department', 'phone']));
  });

  it('phone is optional', async () => {
    const item = await createItem();
    expect((await api('POST', '/api/requests', requestBody(item.id, { phone: '' }), { token: STAFF })).status).toBe(201);
  });

  it('rejects past dates and return dates before the borrowing date', async () => {
    const item = await createItem();
    expect((await api('POST', '/api/requests', requestBody(item.id, { requestedDate: addDays(today(), -1) }), { token: STAFF })).status).toBe(400);
    const backwards = await api(
      'POST',
      '/api/requests',
      requestBody(item.id, { requestedDate: addDays(today(), 5), expectedReturnDate: addDays(today(), 2) }),
      { token: STAFF },
    );
    expect(backwards.data.error.fields.expectedReturnDate).toBeDefined();
  });

  it('rate-limits repeated submissions from one account', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const item = await createItem(`RL-${i}`);
      statuses.push((await api('POST', '/api/requests', requestBody(item.id), { token: STAFF })).status);
    }
    expect(statuses.at(-1)).toBe(429);
  });

  it('rejects duplicate item codes', async () => {
    await createItem('DUP-1');
    expect((await api('POST', '/api/admin/items', { itemCode: 'dup-1', name: 'Other' }, { token: ADMIN })).status).toBe(409);
  });

  it('rejects cross-site POSTs', async () => {
    const r = await handleApi(
      new Request('http://localhost/api/requests', {
        method: 'POST',
        headers: { origin: 'https://evil.example', 'content-type': 'application/json', authorization: `Bearer ${STAFF}` },
        body: JSON.stringify({}),
      }),
    );
    expect(r.status).toBe(403);
  });

  it('item photos are public, everything else needs sign-in', async () => {
    const item = await createItem();
    expect((await api('GET', `/api/items/${item.id}/image`)).status).toBe(404); // no photo, but not 401
    expect((await api('GET', `/api/items/${item.id}`)).status).toBe(401);
  });
});

describe('configuration safety', () => {
  it('refuses memory mode outside local development', () => {
    const saved = { ...process.env };
    try {
      delete process.env.VITEST;
      delete process.env.RM_LOCAL_DEV;
      delete process.env.NETLIFY_DEV;
      process.env.NODE_ENV = 'production';
      process.env.BACKEND_MODE = 'memory';
      expect(() => getConfig()).toThrow(/only allowed for local development/);
    } finally {
      process.env = saved;
    }
  });

  it('reports missing Firebase configuration clearly instead of falling back', async () => {
    const saved = { ...process.env };
    try {
      process.env.BACKEND_MODE = 'firebase';
      delete process.env.FIREBASE_PROJECT_ID;
      const r = await api('GET', '/api/config');
      expect(r.status).toBe(503);
      expect(r.data.error.code).toBe('CONFIG_ERROR');
      expect(r.data.error.message).toContain('FIREBASE_PROJECT_ID');
    } finally {
      process.env = saved;
    }
  });
});
