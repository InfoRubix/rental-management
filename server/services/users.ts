import type { ActorSummary, UserProfile, UserRole, UserStatus } from '../../shared/types';
import type { AppUser, AuthIdentity } from '../backend';
import type { ServerConfig } from '../config';
import type { Db } from '../db/types';
import { AppError, conflict, notFound } from '../errors';
import { C, isProfileComplete, profileOf, toUserAccount, type UserDoc, type UserInviteDoc } from '../model';
import { nowIso } from '../util';
import { recordActivity } from './activity';

/** Refresh "last seen" at most this often, so normal browsing doesn't write on every request. */
const LAST_SEEN_REFRESH_MS = 6 * 60 * 60 * 1000;

function toAppUser(uid: string, u: UserDoc): AppUser {
  const profile = profileOf(u);
  return {
    uid,
    email: u.email,
    name: u.name,
    photoUrl: u.photoUrl,
    role: u.role,
    status: u.status,
    localTest: false,
    profile,
    profileComplete: isProfileComplete(profile),
  };
}

export const normEmail = (e: string) => e.trim().toLowerCase();

const NOT_REGISTERED =
  'This Google account is not registered in Rental Management. Ask an administrator to add your email, then sign in again.';

/**
 * Returns the user record for a verified Google sign-in. Accounts are created ONLY for emails an admin
 * registered first (userInvites): the first sign-in turns the invite into an active account with the
 * role the admin chose. Anyone else is refused and nothing is stored.
 */
export async function getOrCreateUser(db: Db, config: ServerConfig, identity: AuthIdentity): Promise<AppUser> {
  // Most requests come from someone we just looked up: skip the database round trip for a short while.
  const cache = cacheFor(db);
  const hit = cache.get(identity.uid);
  if (hit && hit.expires > Date.now() && hit.doc.email === identity.email && !needsRefresh(hit.doc, identity)) {
    return toAppUser(identity.uid, hit.doc);
  }
  return loadOrCreateUser(db, config, identity);
}

// ---------------------------------------------------------------------------
// Short-lived, per-server-instance cache of account records (one per database, so tests stay isolated).
// Changes made through this server instance clear the entry immediately; changes made elsewhere
// (another serverless instance, the users script) apply within USER_CACHE_MS.
// ---------------------------------------------------------------------------
const USER_CACHE_MS = 30_000;
const caches = new WeakMap<Db, Map<string, { doc: UserDoc; expires: number }>>();
function cacheFor(db: Db) {
  let c = caches.get(db);
  if (!c) caches.set(db, (c = new Map()));
  return c;
}
function remember(db: Db, uid: string, doc: UserDoc) {
  const c = cacheFor(db);
  if (c.size > 5000) c.clear();
  c.set(uid, { doc, expires: Date.now() + USER_CACHE_MS });
}
export function forgetUser(db: Db, uid: string) {
  cacheFor(db).delete(uid);
}

async function loadOrCreateUser(db: Db, _config: ServerConfig, identity: AuthIdentity): Promise<AppUser> {
  const existing = await db.get<UserDoc>(C.users, identity.uid);
  if (existing && !needsRefresh(existing, identity)) {
    remember(db, identity.uid, existing);
    return toAppUser(identity.uid, existing);
  }

  return db.runTransaction(async (tx) => {
    const current = await tx.get<UserDoc>(C.users, identity.uid);
    const now = nowIso();
    if (current) {
      if (!needsRefresh(current, identity)) return toAppUser(identity.uid, current);
      const update = {
        email: identity.email,
        name: identity.name ?? current.name,
        photoUrl: identity.photoUrl ?? current.photoUrl ?? null,
        lastSeenAt: now,
      };
      tx.update(C.users, identity.uid, update);
      return toAppUser(identity.uid, { ...current, ...update });
    }
    const email = identity.email ? normEmail(identity.email) : '';
    const invite = email ? await tx.get<UserInviteDoc>(C.userInvites, email) : null;
    if (!invite) throw new AppError(403, 'NOT_REGISTERED', NOT_REGISTERED);
    const doc: UserDoc = {
      email: identity.email,
      name: identity.name,
      photoUrl: identity.photoUrl,
      role: invite.role,
      status: 'active',
      createdAt: now,
      lastSeenAt: now,
      updatedAt: now,
      updatedBy: invite.invitedBy,
      fullName: '',
      phone: '',
      department: '',
    };
    tx.set(C.users, identity.uid, doc);
    tx.delete(C.userInvites, email);
    recordActivity(tx, {
      action: 'user.joined',
      summary: `${identity.email} signed in for the first time (registered as ${invite.role})`,
      itemId: null,
      itemCode: null,
      requestId: null,
      reference: null,
      fromStatus: null,
      toStatus: doc.status,
      actor: { type: 'staff', uid: identity.uid, email: identity.email, name: identity.name },
      note: null,
    });
    return toAppUser(identity.uid, doc);
  });
}

function needsRefresh(u: UserDoc, identity: AuthIdentity): boolean {
  const stale = !u.lastSeenAt || Date.now() - Date.parse(u.lastSeenAt) > LAST_SEEN_REFRESH_MS;
  return stale || u.email !== identity.email || (!!identity.name && u.name !== identity.name);
}

export async function listUsers(db: Db) {
  const rows = await db.query<UserDoc>(C.users, { limit: 2000 });
  return rows
    .map(toUserAccount)
    .sort((a, b) => (a.status === b.status ? (a.email ?? '').localeCompare(b.email ?? '') : a.status === 'pending' ? -1 : 1));
}

/**
 * Admin changes another account's role or status. Refuses anything that would leave the system
 * without an active admin (including admins demoting or blocking themselves as the last admin).
 */
export async function updateUser(
  db: Db,
  actor: ActorSummary & { uid?: string },
  uid: string,
  change: { role?: UserRole; status?: UserStatus },
) {
  try {
    return await updateUserTx(db, actor, uid, change);
  } finally {
    forgetUser(db, uid); // after the write, so a stale copy can't be re-cached in between
  }
}

function updateUserTx(
  db: Db,
  actor: ActorSummary & { uid?: string },
  uid: string,
  change: { role?: UserRole; status?: UserStatus },
) {
  return db.runTransaction(async (tx) => {
    const user = await tx.get<UserDoc>(C.users, uid);
    if (!user) throw notFound('User not found.');
    const admins = await tx.query<UserDoc>(C.users, { filters: [{ field: 'role', op: '==', value: 'admin' }] });

    const nextRole = change.role ?? user.role;
    const nextStatus = change.status ?? user.status;
    if (nextRole === user.role && nextStatus === user.status) return { user: toUserAccount(user), alreadyDone: true };

    // Only matters when this change takes away an active admin (demote or block/suspend an admin).
    const wasActiveAdmin = user.role === 'admin' && user.status === 'active';
    const staysActiveAdmin = nextRole === 'admin' && nextStatus === 'active';
    if (wasActiveAdmin && !staysActiveAdmin) {
      const otherActiveAdmins = admins.filter((a) => a.id !== uid && a.status === 'active').length;
      if (otherActiveAdmins === 0) {
        throw conflict('There must always be at least one active admin. Make someone else admin first.', 'LAST_ADMIN');
      }
    }
    if (actor.uid === uid && nextStatus !== 'active') {
      throw new AppError(409, 'SELF_BLOCK', 'You cannot block your own account.');
    }

    const now = nowIso();
    const update = { role: nextRole, status: nextStatus, updatedAt: now, updatedBy: actor };
    tx.update(C.users, uid, update);
    const parts = [
      nextRole !== user.role ? `role ${user.role} → ${nextRole}` : null,
      nextStatus !== user.status ? `status ${user.status} → ${nextStatus}` : null,
    ].filter(Boolean);
    recordActivity(tx, {
      action: 'user.updated',
      summary: `Changed ${user.email ?? uid}: ${parts.join(', ')}`,
      itemId: null,
      itemCode: null,
      requestId: null,
      reference: null,
      fromStatus: user.status === nextStatus ? user.role : user.status,
      toStatus: user.status === nextStatus ? nextRole : nextStatus,
      actor,
      note: null,
    });
    return { user: toUserAccount({ ...user, ...update, id: uid }), alreadyDone: false };
  });
}

// ---------------------------------------------------------------------------
// Admin registration (invites)
// ---------------------------------------------------------------------------

export async function listInvites(db: Db) {
  const rows = await db.query<UserInviteDoc>(C.userInvites, { limit: 2000 });
  return rows
    .map((r) => ({ email: r.email, role: r.role, invitedAt: r.invitedAt, invitedBy: r.invitedBy ?? null }))
    .sort((a, b) => b.invitedAt.localeCompare(a.invitedAt));
}

/** Admin registers a person by email. They can sign in with that Google account from then on. */
export async function inviteUser(db: Db, actor: ActorSummary, input: { email: string; role: UserRole }) {
  const email = normEmail(input.email);
  return db.runTransaction(async (tx) => {
    const existingInvite = await tx.get<UserInviteDoc>(C.userInvites, email);
    const accounts = await tx.query<UserDoc>(C.users, { filters: [{ field: 'email', op: '==', value: email }] });
    if (accounts.length) throw conflict(`${email} already has an account. Manage it in the list below.`, 'ALREADY_REGISTERED');
    if (existingInvite) throw conflict(`${email} is already registered and waiting for their first sign-in.`, 'ALREADY_INVITED');
    const now = nowIso();
    const doc: UserInviteDoc = { email, role: input.role, invitedAt: now, invitedBy: actor };
    tx.set(C.userInvites, email, doc);
    recordActivity(tx, {
      action: 'user.registered',
      summary: `Registered ${email} as ${input.role}`,
      itemId: null,
      itemCode: null,
      requestId: null,
      reference: null,
      fromStatus: null,
      toStatus: null,
      actor,
      note: null,
    });
    return { email, role: doc.role, invitedAt: now, invitedBy: actor };
  });
}

/** Cancel a registration before the person has signed in. */
export async function revokeInvite(db: Db, actor: ActorSummary, rawEmail: string) {
  const email = normEmail(rawEmail);
  await db.runTransaction(async (tx) => {
    const invite = await tx.get<UserInviteDoc>(C.userInvites, email);
    if (!invite) throw notFound('That registration no longer exists (they may have signed in already).');
    tx.delete(C.userInvites, email);
    recordActivity(tx, {
      action: 'user.unregistered',
      summary: `Removed the registration for ${email}`,
      itemId: null,
      itemCode: null,
      requestId: null,
      reference: null,
      fromStatus: null,
      toStatus: null,
      actor,
      note: null,
    });
  });
}

// ---------------------------------------------------------------------------
// The signed-in person's own profile
// ---------------------------------------------------------------------------

export async function updateMyProfile(db: Db, user: AppUser, input: UserProfile) {
  if (user.localTest) {
    throw new AppError(409, 'TEST_ACCOUNT', 'Test accounts are not stored, so they have no profile to save.');
  }
  try {
    return await db.runTransaction(async (tx) => {
      const current = await tx.get<UserDoc>(C.users, user.uid);
      if (!current) throw notFound('Account not found.');
      const update = {
        fullName: input.fullName,
        phone: input.phone,
        department: input.department,
        updatedAt: nowIso(),
      };
      tx.update(C.users, user.uid, update);
      return toAppUser(user.uid, { ...current, ...update });
    });
  } finally {
    forgetUser(db, user.uid);
  }
}
