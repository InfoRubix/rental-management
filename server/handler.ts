import type { AppConfig, Me } from '../shared/types';
import { actorFor, authenticate, getBackend, requireAdmin, requireUser, type AppUser, type Backend } from './backend';
import { getConfig } from './config';
import { AppError } from './errors';
import { describeFirebaseError } from './firebaseErrors';
import { enforceMemoryRateLimit, enforceRateLimit, RATE_RULES } from './rateLimit';
import { seedSampleItems } from './devSeed';
import { previewNextCode } from './itemCodes';
import * as items from './services/items';
import * as requests from './services/requests';
import * as users from './services/users';
import { todayIn } from './util';
import {
  createRequestSchema,
  imageUploadSchema,
  inviteSchema,
  itemDeleteSchema,
  itemInputSchema,
  itemPatchSchema,
  itemStatusSchema,
  maintenanceSchema,
  parseInput,
  profileSchema,
  requestActionSchema,
  requestPatchSchema,
  userUpdateSchema,
} from './validation';

export interface RequestContext {
  ip?: string;
  /**
   * The real TCP peer address. Set ONLY by the local Vite dev server (the client cannot forge it);
   * used to decide whether the passwordless test sign-in comes from this computer.
   */
  socketAddress?: string;
}

interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  ip: string;
  backend: Backend;
  body(): Promise<unknown>;
}
interface UserCtx extends Ctx {
  user: AppUser;
}

/**
 * Access levels:
 *  - public: no sign-in (only app config and item photos)
 *  - me:     signed in with Google, any account status (so the app can show "pending" / "blocked")
 *  - user:   signed in, account active (staff or admin)
 *  - admin:  signed in, account active, role admin
 */
type Access = 'public' | 'me' | 'user' | 'admin';
type Route =
  | { method: string; pattern: RegExp; keys: string[]; access: 'public'; run: (c: Ctx) => Promise<Response> }
  | { method: string; pattern: RegExp; keys: string[]; access: Exclude<Access, 'public'>; run: (c: UserCtx) => Promise<Response> };

const routes: Route[] = [];
function compile(path: string) {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k: string) => (keys.push(k), '([^/]+)')) + '/?$');
  return { pattern, keys };
}
const pub = (method: string, path: string, run: (c: Ctx) => Promise<Response>) =>
  routes.push({ method, ...compile(path), access: 'public', run });
const route = (access: Exclude<Access, 'public'>) => (method: string, path: string, run: (c: UserCtx) => Promise<Response>) =>
  routes.push({ method, ...compile(path), access, run });
const me = route('me');
const user = route('user');
const admin = route('admin');

const MAX_BODY_BYTES = 1_000_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return json({ error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } }, err.status);
  }
  const firebase = describeFirebaseError(err);
  if (firebase) {
    console.error('[api] Firebase problem:', firebase.code);
    return json({ error: { code: firebase.code, message: firebase.message } }, 503);
  }
  // Log only a short, non-secret description. Never log request bodies or tokens.
  const e = err as { name?: string; code?: unknown; message?: string };
  console.error('[api] unexpected error:', e?.name ?? 'Error', e?.code ?? '', String(e?.message ?? '').slice(0, 300));
  const msg = String(e?.message ?? '');
  if (/FAILED_PRECONDITION.*index/i.test(msg)) {
    return json({ error: { code: 'INDEX_REQUIRED', message: 'A Firestore index is required. Deploy firestore.indexes.json (see README).' } }, 500);
  }
  return json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong on the server. Please try again.' } }, 500);
}

// ---------------------------------------------------------------------------
// Public (no sign-in)
// ---------------------------------------------------------------------------

pub('GET', '/config', async ({ backend }) => {
  const { config } = backend;
  const body: AppConfig = {
    mode: config.mode,
    publicBaseUrl: config.publicBaseUrl,
    timezone: config.timezone,
    today: todayIn(config.timezone),
    // Project IDs are not secret; the browser uses this to detect mismatched settings.
    firebaseProjectId: config.mode === 'firebase' ? (process.env.FIREBASE_PROJECT_ID?.trim() ?? null) : null,
    devStaffLogin: config.devStaffLogin,
    ...(config.devStaffLogin
      ? { devStaffEmails: config.devStaffEmails, devAdminEmails: config.devAdminEmails, devLanLogin: config.devLanLogin }
      : {}),
  };
  return json(body);
});

// Item photos stay public: <img> tags cannot send sign-in tokens, and photos contain no private data.
pub('GET', '/items/:id/image', async ({ backend, params, ip, url }) => {
  // In-memory limit: a database write per photo would make every catalogue page slow.
  enforceMemoryRateLimit(RATE_RULES.publicRead, ip);
  const img = await items.getItemImage(backend.db, params.id!);
  if (!img) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      'content-type': img.contentType,
      // Photo links carry ?v=<version>, which changes whenever the photo is replaced, so browsers can keep
      // a versioned photo for a year and never ask again.
      'cache-control': url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  });
});

// ---------------------------------------------------------------------------
// Signed in (any status)
// ---------------------------------------------------------------------------

me('GET', '/me', async ({ user: u }) => {
  const body: Me = {
    uid: u.uid,
    email: u.email,
    name: u.name,
    photoUrl: u.photoUrl,
    role: u.role,
    status: u.status,
    localTest: u.localTest,
    profile: u.profile,
    profileComplete: u.profileComplete,
  };
  return json({ me: body });
});

// The signed-in person's own profile (email is read-only: it comes from the admin's registration).
user('PUT', '/my/profile', async ({ backend, user: u, body }) => {
  await enforceRateLimit(backend.db, RATE_RULES.userAction, `user:${u.uid}`);
  const input = parseInput(profileSchema, await body());
  const updated = await users.updateMyProfile(backend.db, u, input);
  return json({ profile: updated.profile, profileComplete: updated.profileComplete });
});

// ---------------------------------------------------------------------------
// Active users (staff and admins): browse, request, manage their OWN requests
// ---------------------------------------------------------------------------

user('GET', '/items', async ({ backend, url }) => {
  const q = (url.searchParams.get('q') ?? '').slice(0, 100);
  return json({ items: await items.listPublicItems(backend.db, q, url.searchParams.get('availability') ?? '') });
});

user('GET', '/items/:id', async ({ backend, params }) => json({ item: await items.getPublicItem(backend.db, params.id!) }));

user('POST', '/requests', async ({ backend, body, user: u }) => {
  await enforceRateLimit(backend.db, RATE_RULES.submitRequest, `user:${u.uid}`);
  const input = parseInput(createRequestSchema, await body());
  const result = await requests.createBorrowRequest(backend.db, backend.config, u, input);
  return json(result, result.duplicate ? 200 : 201);
});

user('GET', '/my/requests', async ({ backend, user: u }) =>
  json({ requests: await requests.listMyRequests(backend.db, backend.config, u) }),
);

user('GET', '/my/requests/:id', async ({ backend, user: u, params }) =>
  json({ request: await requests.getMyRequest(backend.db, backend.config, u, params.id!) }),
);

user('POST', '/my/requests/:id/return', async ({ backend, user: u, params }) => {
  await enforceRateLimit(backend.db, RATE_RULES.userAction, `user:${u.uid}`);
  return json({ request: await requests.myRequestReturn(backend.db, backend.config, u, params.id!) });
});

user('POST', '/my/requests/:id/cancel', async ({ backend, user: u, params }) => {
  await enforceRateLimit(backend.db, RATE_RULES.userAction, `user:${u.uid}`);
  return json({ request: await requests.myRequestCancel(backend.db, backend.config, u, params.id!) });
});

// In-person QR handover: the borrower scans the code on the admin's screen, previews, then confirms.
user('GET', '/my/handover/:code', async ({ backend, user: u, params }) =>
  json(await requests.previewHandover(backend.db, backend.config, u, params.code!)),
);

user('POST', '/my/handover/:code', async ({ backend, user: u, params }) => {
  await enforceRateLimit(backend.db, RATE_RULES.userAction, `user:${u.uid}`);
  return json({ request: await requests.redeemHandover(backend.db, backend.config, u, params.code!) });
});

// Item code / reference search for the scanner page.
user('GET', '/lookup', async ({ backend, url, user: u }) => {
  const code = (url.searchParams.get('code') ?? '').trim();
  if (!code) throw new AppError(400, 'VALIDATION_ERROR', 'Enter an item code.');
  const item = await items.findItemByCode(backend.db, code);
  if (item) return json({ type: 'item', id: item.id });
  if (u.role === 'admin') {
    const requestId = await requests.findRequestByReference(backend.db, code);
    if (requestId) return json({ type: 'request', id: requestId });
  }
  throw new AppError(404, 'NOT_FOUND', `No item found for "${code.slice(0, 40)}".`);
});

// ---------------------------------------------------------------------------
// Admin only
// ---------------------------------------------------------------------------

admin('GET', '/admin/summary', async ({ backend }) => json(await requests.getDashboardSummary(backend.db, backend.config)));

admin('GET', '/admin/items', async ({ backend, url }) =>
  json({ items: await items.listStaffItems(backend.db, url.searchParams.get('q') ?? '', url.searchParams.get('status') ?? '') }),
);

// Preview of the code that will be generated for a blank item code (nothing is reserved).
admin('GET', '/admin/next-item-code', async ({ backend, url }) =>
  json({ code: await previewNextCode(backend.db, (url.searchParams.get('name') ?? '').slice(0, 120)) }),
);

admin('POST', '/admin/items', async ({ backend, user: u, body }) => {
  const input = parseInput(itemInputSchema, await body());
  return json({ item: await items.createItem(backend.db, actorFor(u), input) }, 201);
});

admin('GET', '/admin/items/:id', async ({ backend, params }) =>
  json(await items.getStaffItemDetail(backend.db, params.id!, todayIn(backend.config.timezone))),
);

admin('PATCH', '/admin/items/:id', async ({ backend, user: u, params, body }) => {
  const patch = parseInput(itemPatchSchema, await body());
  return json({ item: await items.updateItem(backend.db, actorFor(u), params.id!, patch) });
});

admin('POST', '/admin/items/:id/status', async ({ backend, user: u, params, body }) => {
  const { status, note } = parseInput(itemStatusSchema, await body());
  return json(await items.setItemStatus(backend.db, actorFor(u), params.id!, status, note));
});

admin('POST', '/admin/items/:id/maintenance', async ({ backend, user: u, params, body }) => {
  const input = parseInput(maintenanceSchema, await body());
  return json(await items.addMaintenanceEntry(backend.db, backend.config.timezone, actorFor(u), params.id!, input));
});

admin('PUT', '/admin/items/:id/image', async ({ backend, user: u, params, body }) => {
  const { dataUrl } = parseInput(imageUploadSchema, await body());
  return json({ item: await items.setItemImage(backend.db, actorFor(u), params.id!, dataUrl) });
});

admin('POST', '/admin/items/:id/delete', async ({ backend, user: u, params, body }) => {
  const { confirmItemCode } = parseInput(itemDeleteSchema, await body());
  return json(await items.deleteItem(backend.db, actorFor(u), params.id!, confirmItemCode));
});

admin('DELETE', '/admin/items/:id/image', async ({ backend, user: u, params }) =>
  json({ item: await items.removeItemImage(backend.db, actorFor(u), params.id!) }),
);

admin('GET', '/admin/requests', async ({ backend, url }) =>
  json({
    requests: await requests.listStaffRequests(
      backend.db,
      backend.config,
      url.searchParams.get('status') ?? '',
      (url.searchParams.get('q') ?? '').slice(0, 100),
    ),
  }),
);

admin('GET', '/admin/requests/:id', async ({ backend, params }) =>
  json(await requests.getStaffRequestDetail(backend.db, backend.config, params.id!)),
);

admin('PATCH', '/admin/requests/:id', async ({ backend, user: u, params, body }) => {
  const patch = parseInput(requestPatchSchema, await body());
  return json({ request: await requests.updateRequestNotes(backend.db, backend.config, actorFor(u), params.id!, patch) });
});

admin('POST', '/admin/requests/:id/actions', async ({ backend, user: u, params, body }) => {
  const input = parseInput(requestActionSchema, await body());
  return json(await requests.applyStaffAction(backend.db, backend.config, actorFor(u), params.id!, input));
});

admin('POST', '/admin/requests/:id/handover-code', async ({ backend, user: u, params }) =>
  json(await requests.createHandoverCode(backend.db, actorFor(u), params.id!), 201),
);

admin('GET', '/admin/activity', async ({ backend }) => json({ activity: await requests.listRecentActivity(backend.db) }));

admin('GET', '/admin/users', async ({ backend }) =>
  json({ users: await users.listUsers(backend.db), invites: await users.listInvites(backend.db) }),
);

// Register a person (staff or admin) by email. Only registered emails can sign in.
admin('POST', '/admin/users', async ({ backend, user: u, body }) => {
  const input = parseInput(inviteSchema, await body());
  return json({ invite: await users.inviteUser(backend.db, actorFor(u), input) }, 201);
});

admin('DELETE', '/admin/invites/:email', async ({ backend, user: u, params }) => {
  await users.revokeInvite(backend.db, actorFor(u), params.email!);
  return json({ ok: true });
});

admin('PATCH', '/admin/users/:uid', async ({ backend, user: u, params, body }) => {
  const change = parseInput(userUpdateSchema, await body());
  return json(await users.updateUser(backend.db, actorFor(u), params.uid!, change));
});

// Development only: load clearly labelled sample items into the in-memory store.
admin('POST', '/admin/dev/seed', async ({ backend }) => {
  if (backend.config.mode !== 'memory') {
    throw new AppError(403, 'NOT_ALLOWED', 'Sample data can only be loaded in memory (development) mode.');
  }
  return json(await seedSampleItems(backend.db, backend.config));
});

// ---------------------------------------------------------------------------

function clientIp(req: Request, ctx: RequestContext): string {
  return (
    ctx.ip ||
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/** Entry point shared by the Netlify Function and the local Vite dev server. */
export async function handleApi(req: Request, ctx: RequestContext = {}): Promise<Response> {
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '') || '/';
    const method = req.method.toUpperCase();

    const candidates = routes.filter((r) => r.pattern.test(path));
    if (!candidates.length) throw new AppError(404, 'NOT_FOUND', 'Unknown API endpoint.');
    const matched = candidates.find((r) => r.method === method);
    if (!matched) throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');

    // Reject cross-site browser writes (defence in depth; the API never sets CORS headers).
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin) {
        const allowed = getConfig().publicBaseUrl;
        if (!allowed || new URL(allowed).origin !== origin) {
          throw new AppError(403, 'BAD_ORIGIN', 'Cross-site requests are not allowed.');
        }
      }
    }

    const match = matched.pattern.exec(path)!;
    const params: Record<string, string> = {};
    matched.keys.forEach((k, i) => (params[k] = decodeURIComponent(match[i + 1]!)));

    const backend = await getBackend();
    let cachedBody: unknown;
    const ctxObj: Ctx = {
      req,
      url,
      params,
      ip: clientIp(req, ctx),
      backend,
      async body() {
        if (cachedBody !== undefined) return cachedBody;
        const text = await req.text();
        if (text.length > MAX_BODY_BYTES) throw new AppError(413, 'TOO_LARGE', 'Request is too large.');
        try {
          cachedBody = text ? JSON.parse(text) : {};
        } catch {
          throw new AppError(400, 'INVALID_JSON', 'Request body must be JSON.');
        }
        return cachedBody;
      },
    };

    if (matched.access === 'public') return await matched.run(ctxObj);
    const peer = { socketAddress: ctx.socketAddress };
    const signedIn =
      matched.access === 'admin'
        ? await requireAdmin(backend, req, peer)
        : matched.access === 'user'
          ? await requireUser(backend, req, peer)
          : await authenticate(backend, req, peer);
    return await matched.run({ ...ctxObj, user: signedIn });
  } catch (err) {
    return errorResponse(err);
  }
}
