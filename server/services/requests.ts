import type { z } from 'zod';
import {
  ACTIVE_LOAN_STATUSES,
  OPEN_REQUEST_STATUSES,
  REQUEST_STATUSES,
  type ActorSummary,
  type DashboardSummary,
  type RequestStatus,
} from '../../shared/types';
import { actorFor, type AppUser } from '../backend';
import type { ServerConfig } from '../config';
import type { Db, WithId } from '../db/types';
import { AppError, badRequest, conflict, notFound } from '../errors';
import {
  C,
  isOverdue,
  publicAvailability,
  toActivityEntry,
  toMyRequestView,
  toStaffItem,
  toStaffRequest,
  type ActivityDoc,
  type ItemDoc,
  type RequestDoc,
} from '../model';
import { addDays, digitsOnly, newId, newReference, nowIso, sha256, todayIn } from '../util';
import type { createRequestSchema, requestActionSchema, requestPatchSchema } from '../validation';
import { recordActivity } from './activity';

type CreateRequestInput = z.output<typeof createRequestSchema>;
type ActionInput = z.output<typeof requestActionSchema>;
type PatchInput = z.output<typeof requestPatchSchema>;

const MAX_BOOKING_HORIZON_DAYS = 365;

// ---------------------------------------------------------------------------
// Borrower (signed-in staff) operations — always limited to the caller's OWN requests
// ---------------------------------------------------------------------------

export async function createBorrowRequest(
  db: Db,
  config: ServerConfig,
  user: AppUser,
  input: CreateRequestInput,
  opts: { sample?: boolean } = {},
) {
  const today = todayIn(config.timezone);
  // Staff borrow under their saved profile (name, department, phone). Test accounts have no stored profile.
  if (!user.localTest && !user.profileComplete) {
    throw conflict('Please complete your profile (full name, phone and department) before requesting an item.', 'PROFILE_INCOMPLETE');
  }
  const useProfile = !user.localTest && user.profileComplete;
  const department = useProfile ? user.profile.department : input.department;
  const phone = useProfile ? user.profile.phone : input.phone;
  const fieldErrors: Record<string, string> = {};
  if (input.requestedDate < today) fieldErrors.requestedDate = 'The borrowing date cannot be in the past.';
  if (input.requestedDate > addDays(today, MAX_BOOKING_HORIZON_DAYS))
    fieldErrors.requestedDate = 'Please choose a date within the next 12 months.';
  if (input.expectedReturnDate < input.requestedDate)
    fieldErrors.expectedReturnDate = 'The return date must be on or after the borrowing date.';
  if (input.expectedReturnDate > addDays(input.requestedDate, MAX_BOOKING_HORIZON_DAYS))
    fieldErrors.expectedReturnDate = 'The return date must be within 12 months of the borrowing date.';
  if (Object.keys(fieldErrors).length) throw badRequest('Please check the dates.', fieldErrors);

  // Scoped to the user, so another person can never "claim" someone else's form ID.
  const submissionKey = sha256(`submission:${user.uid}:${input.clientRequestId}`).slice(0, 40);

  return db.runTransaction(async (tx) => {
    // ---- reads ----
    const previous = await tx.get<{ requestId: string; reference: string }>(C.submissionKeys, submissionKey);
    if (previous) {
      // The same form was submitted twice (double click / network retry). Do not create a second request.
      return { duplicate: true as const, reference: previous.reference, requestId: previous.requestId };
    }
    const item = await tx.get<ItemDoc>(C.items, input.itemId);
    if (!item || item.status === 'Inactive') throw notFound('This item is not available for borrowing.');
    if (!publicAvailability(item).canRequest) {
      throw conflict('Sorry, this item is not available to request right now.', 'ITEM_UNAVAILABLE');
    }
    const forItem = await tx.query<RequestDoc>(C.requests, { filters: [{ field: 'itemId', op: '==', value: item.id }] });
    if (forItem.some((r) => r.borrowerUid === user.uid && (r.status === 'Pending' || r.status === 'Approved'))) {
      throw conflict('You already have an open request for this item. See "My requests".', 'ALREADY_REQUESTED');
    }
    let reference = '';
    for (let attempt = 0; attempt < 5 && !reference; attempt++) {
      const candidate = newReference();
      if (!(await tx.get(C.requestRefs, candidate))) reference = candidate;
    }
    if (!reference) throw new AppError(503, 'TRY_AGAIN', 'Please try again.');

    // ---- writes ----
    const id = newId();
    const now = nowIso();
    const doc: RequestDoc = {
      reference,
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.name,
      borrowerUid: user.uid,
      customerName: (useProfile && user.profile.fullName) || user.name || user.email || 'Unknown',
      department,
      phone,
      phoneKey: digitsOnly(phone),
      email: user.email,
      requestedDate: input.requestedDate,
      expectedReturnDate: input.expectedReturnDate,
      customerNotes: input.customerNotes,
      staffNotes: '',
      customerMessage: '',
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
      approvedBy: null,
      rejectedAt: null,
      rejectedBy: null,
      handoverAt: null,
      handoverBy: null,
      returnRequestedAt: null,
      returnedAt: null,
      returnedBy: null,
      returnCondition: null,
      cancelledAt: null,
      cancelledBy: null,
      ...(opts.sample ? { sample: true } : {}),
    };
    tx.set(C.requests, id, doc);
    tx.set(C.requestRefs, reference, { requestId: id });
    tx.set(C.submissionKeys, submissionKey, { requestId: id, reference, createdAt: now });
    recordActivity(tx, {
      action: 'request.submitted',
      summary: `Borrowing request ${reference} submitted for ${item.itemCode} by ${user.email}`,
      itemId: item.id,
      itemCode: item.itemCode,
      requestId: id,
      reference,
      fromStatus: null,
      toStatus: 'Pending',
      actor: actorFor(user),
      note: null,
    });
    return { duplicate: false as const, reference, requestId: id };
  });
}

/** 404 (not 403) for other people's requests, so request IDs can't be probed. */
const NOT_YOURS = 'Request not found.';

export async function listMyRequests(db: Db, config: ServerConfig, user: AppUser) {
  const today = todayIn(config.timezone);
  const rows = await db.query<RequestDoc>(C.requests, { filters: [{ field: 'borrowerUid', op: '==', value: user.uid }] });
  return rows
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => toMyRequestView(r, null, today));
}

export async function getMyRequest(db: Db, config: ServerConfig, user: AppUser, id: string) {
  const req = await db.get<RequestDoc>(C.requests, id);
  if (!req || !req.borrowerUid || req.borrowerUid !== user.uid) throw notFound(NOT_YOURS);
  const item = await db.get<ItemDoc>(C.items, req.itemId);
  return toMyRequestView(req, item, todayIn(config.timezone));
}

export async function myRequestReturn(db: Db, config: ServerConfig, user: AppUser, id: string) {
  await db.runTransaction(async (tx) => {
    const req = await tx.get<RequestDoc>(C.requests, id);
    if (!req || req.borrowerUid !== user.uid) throw notFound(NOT_YOURS);
    // Already returning, or the admin already confirmed the return (e.g. the item was dropped off):
    // nothing left to do, so don't show an error for a stale button press.
    if (req.status === 'Return requested' || req.status === 'Returned') return;
    if (req.status !== 'On loan') {
      throw conflict(`A return can only be requested while the item is on loan (current status: ${req.status}).`);
    }
    const now = nowIso();
    tx.update(C.requests, req.id, { status: 'Return requested', returnRequestedAt: now, updatedAt: now });
    recordActivity(tx, {
      action: 'request.return-requested',
      summary: `${user.email} is returning ${req.itemCode} (${req.reference}). Awaiting admin inspection.`,
      itemId: req.itemId,
      itemCode: req.itemCode,
      requestId: req.id,
      reference: req.reference,
      fromStatus: 'On loan',
      toStatus: 'Return requested',
      actor: actorFor(user),
      note: null,
    });
  });
  return getMyRequest(db, config, user, id);
}

export async function myRequestCancel(db: Db, config: ServerConfig, user: AppUser, id: string) {
  await db.runTransaction(async (tx) => {
    const req = await tx.get<RequestDoc>(C.requests, id);
    if (!req || req.borrowerUid !== user.uid) throw notFound(NOT_YOURS);
    const item = await tx.get<ItemDoc>(C.items, req.itemId);
    if (req.status === 'Cancelled') return;
    if (req.status !== 'Pending' && req.status !== 'Approved') {
      throw conflict(`This request can no longer be cancelled (current status: ${req.status}).`);
    }
    const now = nowIso();
    tx.update(C.requests, req.id, { status: 'Cancelled', cancelledAt: now, cancelledBy: actorFor(user), updatedAt: now });
    if (item && item.holdRequestId === req.id) tx.update(C.items, item.id, { holdRequestId: null, updatedAt: now });
    recordActivity(tx, {
      action: 'request.cancelled',
      summary: `${user.email} cancelled request ${req.reference}`,
      itemId: req.itemId,
      itemCode: req.itemCode,
      requestId: req.id,
      reference: req.reference,
      fromStatus: req.status,
      toStatus: 'Cancelled',
      actor: actorFor(user),
      note: null,
    });
  });
  return getMyRequest(db, config, user, id);
}


// ---------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------

const TARGET: Record<ActionInput['action'], RequestStatus> = {
  approve: 'Approved',
  reject: 'Rejected',
  cancel: 'Cancelled',
  handover: 'On loan',
  'confirm-return': 'Returned',
};

/**
 * Applies a staff action atomically. Reads the request and its item inside a transaction,
 * checks the transition, then writes request + item + activity together. If two staff
 * members act at the same moment, one wins and the other sees the updated state.
 * Repeating an action that already happened returns `alreadyDone: true` and writes nothing.
 */
export async function applyStaffAction(
  db: Db,
  config: ServerConfig,
  actor: ActorSummary,
  requestId: string,
  input: ActionInput,
) {
  const today = todayIn(config.timezone);
  return db.runTransaction(async (tx) => {
    const req = await tx.get<RequestDoc>(C.requests, requestId);
    if (!req) throw notFound('Request not found.');
    const item = await tx.get<ItemDoc>(C.items, req.itemId);
    if (!item) throw notFound('The item for this request no longer exists.');

    const target = TARGET[input.action];
    const already =
      req.status === target || (input.action === 'handover' && !!req.handoverAt && req.status !== 'Approved');
    if (already) {
      return { alreadyDone: true, request: toStaffRequest(req, today), item: toStaffItem(item) };
    }

    const now = nowIso();
    const reqUpdate: Partial<RequestDoc> = { status: target, updatedAt: now };
    const itemUpdate: Partial<ItemDoc> = {};
    let summary = '';
    const blocked = (allowed: RequestStatus[]) => {
      if (!allowed.includes(req.status)) {
        throw conflict(`Cannot ${input.action.replace('-', ' ')} a request that is "${req.status}".`);
      }
    };

    switch (input.action) {
      case 'approve': {
        blocked(['Pending']);
        if (item.status !== 'Available') throw conflict(`The item is "${item.status}" and cannot be approved for lending.`);
        if (item.holdRequestId && item.holdRequestId !== req.id) {
          throw conflict(
            'Another request for this item is already approved or on loan. Resolve that request before approving this one.',
            'ITEM_HELD',
          );
        }
        Object.assign(reqUpdate, { approvedAt: now, approvedBy: actor });
        itemUpdate.holdRequestId = req.id;
        summary = `Approved request ${req.reference} (not yet handed over)`;
        break;
      }
      case 'reject': {
        blocked(['Pending']);
        Object.assign(reqUpdate, { rejectedAt: now, rejectedBy: actor });
        summary = `Rejected request ${req.reference}`;
        break;
      }
      case 'cancel': {
        blocked(['Pending', 'Approved']);
        Object.assign(reqUpdate, { cancelledAt: now, cancelledBy: actor });
        if (item.holdRequestId === req.id) itemUpdate.holdRequestId = null;
        summary = `Cancelled request ${req.reference}`;
        break;
      }
      case 'handover': {
        blocked(['Approved']);
        if (item.holdRequestId !== req.id) {
          throw conflict('This item is not reserved for this request. Approve the request again.', 'ITEM_HELD');
        }
        if (item.status !== 'Available') {
          throw conflict(`The item is "${item.status}" and cannot be handed over.`);
        }
        Object.assign(reqUpdate, { handoverAt: now, handoverBy: actor });
        itemUpdate.status = 'On loan';
        summary = `Handed over ${item.itemCode} to ${req.email || 'the customer'} (${req.reference}). Item is now On loan.`;
        break;
      }
      case 'confirm-return': {
        blocked(['On loan', 'Return requested']);
        if (!input.condition) {
          throw badRequest('Choose the condition of the returned item.', { condition: 'Required.' });
        }
        const nextItemStatus = input.condition === 'good' ? 'Available' : 'Under maintenance';
        Object.assign(reqUpdate, { returnedAt: now, returnedBy: actor, returnCondition: input.condition });
        itemUpdate.status = nextItemStatus;
        itemUpdate.holdRequestId = null;
        if (input.conditionNotes) {
          const line = `${today} (${req.reference} return): ${input.conditionNotes}`;
          itemUpdate.conditionNotes = item.conditionNotes ? `${line}\n${item.conditionNotes}` : line;
        }
        summary = `Confirmed receipt of ${item.itemCode} (${req.reference}). Item is now ${nextItemStatus}.`;
        break;
      }
    }

    if (input.customerMessage !== undefined) reqUpdate.customerMessage = input.customerMessage;
    tx.update(C.requests, req.id, reqUpdate);
    if (Object.keys(itemUpdate).length) {
      Object.assign(itemUpdate, { updatedAt: now, updatedBy: actor });
      tx.update(C.items, item.id, itemUpdate);
    }
    recordActivity(tx, {
      action: `request.${input.action}`,
      summary,
      itemId: item.id,
      itemCode: item.itemCode,
      requestId: req.id,
      reference: req.reference,
      fromStatus: req.status,
      toStatus: target,
      actor,
      note: input.note || null,
    });
    return {
      alreadyDone: false,
      request: toStaffRequest({ ...req, ...reqUpdate } as WithId<RequestDoc>, today),
      item: toStaffItem({ ...item, ...itemUpdate } as WithId<ItemDoc>),
    };
  });
}

export async function updateRequestNotes(db: Db, config: ServerConfig, actor: ActorSummary, id: string, patch: PatchInput) {
  const today = todayIn(config.timezone);
  return db.runTransaction(async (tx) => {
    const req = await tx.get<RequestDoc>(C.requests, id);
    if (!req) throw notFound('Request not found.');
    const changes: Partial<RequestDoc> = {};
    if (patch.staffNotes !== undefined && patch.staffNotes !== req.staffNotes) changes.staffNotes = patch.staffNotes;
    if (patch.customerMessage !== undefined && patch.customerMessage !== req.customerMessage)
      changes.customerMessage = patch.customerMessage;
    if (!Object.keys(changes).length) return toStaffRequest(req, today);
    changes.updatedAt = nowIso();
    tx.update(C.requests, id, changes);
    recordActivity(tx, {
      action: 'request.notes-updated',
      summary: `Updated ${[changes.staffNotes !== undefined && 'staff notes', changes.customerMessage !== undefined && 'customer message'].filter(Boolean).join(' and ')} on ${req.reference}`,
      itemId: req.itemId,
      itemCode: req.itemCode,
      requestId: id,
      reference: req.reference,
      fromStatus: null,
      toStatus: null,
      actor,
      note: null,
    });
    return toStaffRequest({ ...req, ...changes }, today);
  });
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

function requestMatches(r: RequestDoc, q: string): boolean {
  if (!q) return true;
  const hay = `${r.reference} ${r.customerName} ${r.department ?? ''} ${r.phone} ${r.email ?? ''} ${r.itemCode} ${r.itemName}`.toLowerCase();
  const qDigits = digitsOnly(q);
  return (
    q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((w) => hay.includes(w)) || (qDigits.length >= 4 && r.phoneKey.includes(qDigits))
  );
}

export async function listStaffRequests(db: Db, config: ServerConfig, status: string, q: string) {
  const today = todayIn(config.timezone);
  let rows: WithId<RequestDoc>[];
  if (status === 'Overdue') {
    rows = (
      await db.query<RequestDoc>(C.requests, { filters: [{ field: 'status', op: 'in', value: [...ACTIVE_LOAN_STATUSES] }] })
    ).filter((r) => isOverdue(r, today));
  } else if (status === 'Open') {
    rows = await db.query<RequestDoc>(C.requests, { filters: [{ field: 'status', op: 'in', value: [...OPEN_REQUEST_STATUSES] }] });
  } else if ((REQUEST_STATUSES as readonly string[]).includes(status)) {
    rows = await db.query<RequestDoc>(C.requests, { filters: [{ field: 'status', op: '==', value: status }] });
  } else {
    rows = await db.query<RequestDoc>(C.requests, { orderBy: { field: 'createdAt', direction: 'desc' }, limit: 500 });
  }
  return rows
    .filter((r) => requestMatches(r, q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => toStaffRequest(r, today));
}

export async function getStaffRequestDetail(db: Db, config: ServerConfig, id: string) {
  const req = await db.get<RequestDoc>(C.requests, id);
  if (!req) throw notFound('Request not found.');
  const [item, activity] = await Promise.all([
    db.get<ItemDoc>(C.items, req.itemId),
    db.query<ActivityDoc>(C.activity, { filters: [{ field: 'requestId', op: '==', value: id }] }),
  ]);
  return {
    request: toStaffRequest(req, todayIn(config.timezone)),
    item: item ? toStaffItem(item) : null,
    activity: activity.sort((a, b) => b.at.localeCompare(a.at)).map(toActivityEntry),
  };
}

export async function findRequestByReference(db: Db, reference: string) {
  const ref = await db.get<{ requestId: string }>(C.requestRefs, reference.trim().toUpperCase());
  return ref?.requestId ?? null;
}

export async function getDashboardSummary(db: Db, config: ServerConfig): Promise<DashboardSummary> {
  const today = todayIn(config.timezone);
  const [open, items] = await Promise.all([
    db.query<RequestDoc>(C.requests, { filters: [{ field: 'status', op: 'in', value: [...OPEN_REQUEST_STATUSES] }] }),
    db.query<ItemDoc>(C.items, { filters: [{ field: 'status', op: 'in', value: ['Available', 'Under maintenance'] }] }),
  ]);
  const view = open.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => toStaffRequest(r, today));
  const pending = view.filter((r) => r.status === 'Pending');
  const awaitingHandover = view.filter((r) => r.status === 'Approved');
  const returnRequested = view.filter((r) => r.status === 'Return requested');
  const activeLoans = view.filter((r) => ACTIVE_LOAN_STATUSES.includes(r.status));
  const overdue = activeLoans.filter((r) => r.overdue).sort((a, b) => a.expectedReturnDate.localeCompare(b.expectedReturnDate));
  return {
    counts: {
      availableItems: items.filter((i) => i.status === 'Available' && !i.holdRequestId).length,
      underMaintenance: items.filter((i) => i.status === 'Under maintenance').length,
      activeLoans: activeLoans.length,
      pendingRequests: pending.length,
      overdueLoans: overdue.length,
      awaitingHandover: awaitingHandover.length,
      returnRequested: returnRequested.length,
    },
    pending: pending.slice(0, 20),
    awaitingHandover: awaitingHandover.slice(0, 20),
    returnRequested: returnRequested.slice(0, 20),
    overdue: overdue.slice(0, 20),
  };
}

export async function listRecentActivity(db: Db, limit = 20) {
  const rows = await db.query<ActivityDoc>(C.activity, { orderBy: { field: 'at', direction: 'desc' }, limit });
  return rows.map(toActivityEntry);
}

// ---------------------------------------------------------------------------
// In-person QR handover
//
// The admin shows a short-lived, single-use QR on their screen. The borrower scans it and confirms,
// which approves (if still pending) and hands the item over in one step. Being able to scan the
// admin's screen at that moment is the proof that both people are together with the item.
// Only a hash of the code is stored; creating a new code invalidates the previous one.
// ---------------------------------------------------------------------------

export const HANDOVER_CODE_TTL_MS = 3 * 60 * 1000;

interface HandoverCodeDoc {
  requestId: string;
  createdBy: ActorSummary;
  expiresAt: string;
  /** Firestore TTL field so stale codes are cleaned up automatically. */
  expireAt: Date;
  [key: string]: unknown;
}

const codeHash = (code: string) => sha256(`handover:${code}`).slice(0, 48);
const HANDOVER_INVALID = 'This handover code is not valid. Ask the admin to show a new one.';

/** Checks the request and item can be handed over now; shared by code creation and redemption. */
function assertHandoverPossible(req: WithId<RequestDoc>, item: WithId<ItemDoc> | null) {
  if (req.status !== 'Pending' && req.status !== 'Approved') {
    throw conflict(`This request is "${req.status}" and can no longer be handed over.`);
  }
  if (!req.borrowerUid) throw conflict('This request has no linked borrower account, so it cannot use QR handover.');
  if (!item) throw notFound('The item for this request no longer exists.');
  if (item.status !== 'Available') throw conflict(`The item is "${item.status}" and cannot be handed over.`);
  if (item.holdRequestId && item.holdRequestId !== req.id) {
    throw conflict('Another request for this item is already approved or on loan.', 'ITEM_HELD');
  }
}

export async function createHandoverCode(db: Db, actor: ActorSummary, requestId: string) {
  return db.runTransaction(async (tx) => {
    const req = await tx.get<RequestDoc>(C.requests, requestId);
    if (!req) throw notFound('Request not found.');
    const item = await tx.get<ItemDoc>(C.items, req.itemId);
    assertHandoverPossible(req, item);

    const code = newId(32);
    const hash = codeHash(code);
    const expires = Date.now() + HANDOVER_CODE_TTL_MS;
    const expiresAt = new Date(expires).toISOString();
    if (typeof req.handoverCodeHash === 'string') tx.delete(C.handoverCodes, req.handoverCodeHash);
    tx.set(C.handoverCodes, hash, {
      requestId: req.id,
      createdBy: actor,
      expiresAt,
      expireAt: new Date(expires),
    } satisfies HandoverCodeDoc);
    tx.update(C.requests, req.id, { handoverCodeHash: hash });
    return { code, expiresAt };
  });
}

async function loadHandover(tx: Pick<Db, 'get'>, user: AppUser, code: string) {
  if (!/^[A-Za-z0-9]{32}$/.test(code)) throw notFound(HANDOVER_INVALID);
  const hash = codeHash(code);
  const doc = await tx.get<HandoverCodeDoc>(C.handoverCodes, hash);
  if (!doc) throw notFound(HANDOVER_INVALID);
  const req = await tx.get<RequestDoc>(C.requests, doc.requestId);
  if (!req || req.handoverCodeHash !== hash) throw notFound(HANDOVER_INVALID);
  if (req.borrowerUid !== user.uid) {
    throw new AppError(403, 'NOT_YOUR_REQUEST', 'This handover code is for someone else’s request. Only the borrower can scan it.');
  }
  if (Date.parse(doc.expiresAt) <= Date.now()) {
    throw new AppError(410, 'CODE_EXPIRED', 'This handover code has expired. Ask the admin to show a new one.');
  }
  const item = await tx.get<ItemDoc>(C.items, req.itemId);
  return { hash, doc, req, item };
}

export async function previewHandover(db: Db, config: ServerConfig, user: AppUser, code: string) {
  const { doc, req, item } = await loadHandover(db, user, code);
  assertHandoverPossible(req, item);
  return {
    request: toMyRequestView(req, item, todayIn(config.timezone)),
    expiresAt: doc.expiresAt,
    adminName: doc.createdBy.name || doc.createdBy.email || 'Admin',
  };
}

export async function redeemHandover(db: Db, config: ServerConfig, user: AppUser, code: string) {
  const requestId = await db.runTransaction(async (tx) => {
    const { hash, doc, req, item } = await loadHandover(tx, user, code);
    assertHandoverPossible(req, item);
    const now = nowIso();
    const admin = doc.createdBy;
    const wasPending = req.status === 'Pending';
    tx.update(C.requests, req.id, {
      status: 'On loan',
      updatedAt: now,
      ...(wasPending ? { approvedAt: now, approvedBy: admin } : {}),
      handoverAt: now,
      handoverBy: admin,
      handoverCodeHash: null,
    });
    tx.update(C.items, item!.id, { status: 'On loan', holdRequestId: req.id, updatedAt: now, updatedBy: admin });
    tx.delete(C.handoverCodes, hash);
    recordActivity(tx, {
      action: 'request.handover',
      summary: `Handed over ${req.itemCode} (${req.reference}) in person by QR code${wasPending ? ' (approved at handover)' : ''}. Receipt confirmed by ${user.email}. Item is now On loan.`,
      itemId: req.itemId,
      itemCode: req.itemCode,
      requestId: req.id,
      reference: req.reference,
      fromStatus: req.status,
      toStatus: 'On loan',
      actor: admin,
      note: null,
    });
    return req.id;
  });
  return getMyRequest(db, config, user, requestId);
}
