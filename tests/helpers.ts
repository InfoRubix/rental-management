import { randomUUID } from 'node:crypto';
import { handleApi } from '../server/handler';
import { addDays, todayIn } from '../server/util';

// Test identities (see `test.env` in vite.config.ts). "dev:" tokens are the local passwordless sign-in.
export const ADMIN = 'dev:admin@test.local';
export const STAFF = 'dev:staff@test.local';
export const STAFF2 = 'dev:staff2@test.local';
export const NOT_LISTED = 'dev:someone.else@test.local';
/** Simulated verified Google sign-in (only accepted inside automated tests). */
export const google = (uid: string, email: string) => `google-test:${uid}:${email}`;

let ipCounter = 0;

export async function api(
  method: string,
  path: string,
  body?: unknown,
  opts: { token?: string; ip?: string } = {},
): Promise<{ status: number; data: any; text: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await handleApi(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ip: opts.ip ?? `10.0.0.${++ipCounter}` },
  );
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data, text };
}

export const today = () => todayIn('UTC');

export async function createItem(code = 'PROJ-001', extra: Record<string, unknown> = {}) {
  const r = await api('POST', '/api/admin/items', { itemCode: code, name: `Projector ${code}`, ...extra }, { token: ADMIN });
  if (r.status !== 201) throw new Error(`createItem failed: ${r.text}`);
  return r.data.item as { id: string; itemCode: string };
}

export function requestBody(itemId: string, extra: Record<string, unknown> = {}) {
  return {
    itemId,
    department: 'Finance, KL branch',
    phone: '+60 12-345 6789',
    requestedDate: today(),
    expectedReturnDate: addDays(today(), 3),
    customerNotes: 'For a workshop',
    clientRequestId: randomUUID(),
    ...extra,
  };
}

export async function submitRequest(itemId: string, extra: Record<string, unknown> = {}, token = STAFF) {
  const r = await api('POST', '/api/requests', requestBody(itemId, extra), { token });
  if (r.status !== 201) throw new Error(`submitRequest failed: ${r.text}`);
  return r.data as { reference: string; requestId: string };
}

export async function act(requestId: string, action: string, extra: Record<string, unknown> = {}) {
  return api('POST', `/api/admin/requests/${requestId}/actions`, { action, ...extra }, { token: ADMIN });
}

/** Creates an item and takes a request (by STAFF) all the way to "On loan". */
export async function itemOnLoan(code = 'PROJ-LOAN') {
  const item = await createItem(code);
  const sub = await submitRequest(item.id);
  await act(sub.requestId, 'approve');
  await act(sub.requestId, 'handover');
  return { item, ...sub };
}
