import { OPEN_REQUEST_STATUSES, type ActorSummary, type ItemStatus } from '../../shared/types';
import type { Db, WithId } from '../db/types';
import { AppError, conflict, notFound } from '../errors';
import {
  C,
  toActivityEntry,
  toMaintenanceEntry,
  toPublicItem,
  toStaffItem,
  type ActivityDoc,
  type ItemDoc,
  type MaintenanceDoc,
  type RequestDoc,
} from '../model';
import { newId, nowIso, sha256, todayIn } from '../util';
import type { itemInputSchema, itemPatchSchema, maintenanceSchema } from '../validation';
import type { z } from 'zod';
import { recordActivity } from './activity';
import { reserveNextCode } from '../itemCodes';
import { toStaffRequest } from '../model';

type ItemInput = z.output<typeof itemInputSchema>;
type ItemPatch = z.output<typeof itemPatchSchema>;
type MaintenanceInput = z.output<typeof maintenanceSchema>;

const MAX_LIST = 2000;

export async function createItem(db: Db, actor: ActorSummary, input: ItemInput, opts: { sample?: boolean } = {}) {
  const id = newId();
  const now = nowIso();
  const item = await db.runTransaction(async (tx) => {
    let itemCode = input.itemCode;
    let commitCounter: (() => void) | null = null;
    if (!itemCode) {
      // Blank code: generate the next free one (e.g. PROJ-003) atomically with the save.
      const reserved = await reserveNextCode(tx, input.name);
      itemCode = reserved.code;
      commitCounter = reserved.commit;
    } else {
      const existing = await tx.get(C.itemCodes, itemCode);
      if (existing) throw conflict(`Item code ${itemCode} is already used by another item.`, 'DUPLICATE_ITEM_CODE');
    }
    commitCounter?.();
    const doc: ItemDoc = {
      itemCode,
      name: input.name,
      nameLower: input.name.toLowerCase(),
      description: input.description,
      category: input.category,
      conditionNotes: input.conditionNotes,
      externalImageUrl: input.externalImageUrl,
      brand: input.brand,
      model: input.model,
      serialNumber: input.serialNumber,
      location: input.location,
      purchaseDate: input.purchaseDate,
      warrantyExpiry: input.warrantyExpiry,
      imageVersion: null,
      status: 'Available',
      holdRequestId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
      ...(opts.sample ? { sample: true } : {}),
    };
    tx.set(C.items, id, doc);
    tx.set(C.itemCodes, itemCode, { itemId: id });
    recordActivity(tx, {
      action: 'item.created',
      summary: `Registered item ${itemCode} (${input.name})${commitCounter ? ' — code generated automatically' : ''}`,
      itemId: id,
      itemCode,
      requestId: null,
      reference: null,
      fromStatus: null,
      toStatus: 'Available',
      actor,
      note: null,
    });
    return { ...doc, id };
  });
  return toStaffItem(item);
}

export async function updateItem(db: Db, actor: ActorSummary, id: string, patch: ItemPatch) {
  const item = await db.runTransaction(async (tx) => {
    const current = await tx.get<ItemDoc>(C.items, id);
    if (!current) throw notFound('Item not found.');
    const codeChanged = patch.itemCode !== undefined && patch.itemCode !== current.itemCode;
    if (codeChanged) {
      const taken = await tx.get(C.itemCodes, patch.itemCode!);
      if (taken) throw conflict(`Item code ${patch.itemCode} is already used by another item.`, 'DUPLICATE_ITEM_CODE');
    }
    const changes: Partial<ItemDoc> = {};
    const keys = ['itemCode', 'name', 'description', 'category', 'conditionNotes', 'externalImageUrl', 'brand', 'model', 'serialNumber', 'location', 'purchaseDate', 'warrantyExpiry'] as const;
    for (const key of keys) {
      const next = patch[key];
      if (next !== undefined && next !== (current[key] ?? '')) changes[key] = next;
    }
    if (Object.keys(changes).length === 0) return current;
    if (changes.name) changes.nameLower = changes.name.toLowerCase();
    const update = { ...changes, updatedAt: nowIso(), updatedBy: actor };
    tx.update(C.items, id, update);
    if (codeChanged) {
      tx.delete(C.itemCodes, current.itemCode);
      tx.set(C.itemCodes, patch.itemCode!, { itemId: id });
    }
    recordActivity(tx, {
      action: 'item.updated',
      summary: `Edited item details (${Object.keys(changes)
        .filter((k) => k !== 'nameLower')
        .join(', ')})${codeChanged ? ` — code changed from ${current.itemCode} to ${patch.itemCode}` : ''}`,
      itemId: id,
      itemCode: changes.itemCode ?? current.itemCode,
      requestId: null,
      reference: null,
      fromStatus: null,
      toStatus: null,
      actor,
      note: null,
    });
    return { ...current, ...update };
  });
  return toStaffItem(item);
}

/**
 * Manual status changes. "On loan" can only be reached through a confirmed handover,
 * and an item cannot leave "On loan" except through a confirmed return.
 */
export async function setItemStatus(
  db: Db,
  actor: ActorSummary,
  id: string,
  target: Exclude<ItemStatus, 'On loan'>,
  note: string,
) {
  return db.runTransaction(async (tx) => {
    const item = await tx.get<ItemDoc>(C.items, id);
    if (!item) throw notFound('Item not found.');
    const requests = target === 'Inactive' ? await tx.query<RequestDoc>(C.requests, { filters: [{ field: 'itemId', op: '==', value: id }] }) : [];

    if (item.status === target) return { item: toStaffItem(item), alreadyDone: true };
    if (item.status === 'On loan') {
      throw conflict('This item is on loan. Confirm its return before changing its status.');
    }
    if (item.holdRequestId) {
      throw conflict(
        'This item has an approved request waiting for handover. Hand it over, or cancel that request, before changing its status.',
      );
    }
    if (target === 'Inactive') {
      const open = requests.filter((r) => OPEN_REQUEST_STATUSES.includes(r.status));
      if (open.length > 0) {
        throw conflict(
          `This item has ${open.length} open request(s) (${open.map((r) => r.reference).join(', ')}). Approve, reject or close them before deactivating.`,
        );
      }
    }
    const now = nowIso();
    tx.update(C.items, id, { status: target, updatedAt: now, updatedBy: actor });
    recordActivity(tx, {
      action: 'item.status-changed',
      summary: `Item status changed from ${item.status} to ${target}`,
      itemId: id,
      itemCode: item.itemCode,
      requestId: null,
      reference: null,
      fromStatus: item.status,
      toStatus: target,
      actor,
      note: note || null,
    });
    return { item: toStaffItem({ ...item, status: target, updatedAt: now, updatedBy: actor }), alreadyDone: false };
  });
}

const IMAGE_TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b) => b.subarray(0, 4).toString('hex') === '89504e47',
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
};
const MAX_IMAGE_BYTES = 500 * 1024;

export async function setItemImage(db: Db, actor: ActorSummary, id: string, dataUrl: string) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new AppError(400, 'INVALID_IMAGE', 'Upload a JPEG, PNG or WebP image.');
  const contentType = m[1]!;
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length === 0 || !IMAGE_TYPES[contentType]!(bytes)) {
    throw new AppError(400, 'INVALID_IMAGE', 'The file is not a valid image.');
  }
  if (bytes.length > MAX_IMAGE_BYTES) throw new AppError(400, 'INVALID_IMAGE', 'Image is too large (max 500 KB).');
  const item = await db.runTransaction(async (tx) => {
    const current = await tx.get<ItemDoc>(C.items, id);
    if (!current) throw notFound('Item not found.');
    const now = nowIso();
    tx.set(C.itemImages, id, { contentType, data: bytes.toString('base64'), updatedAt: now });
    tx.update(C.items, id, { imageVersion: now, updatedAt: now, updatedBy: actor });
    recordActivity(tx, {
      action: 'item.image-updated',
      summary: 'Uploaded a new item photo',
      itemId: id,
      itemCode: current.itemCode,
      requestId: null,
      reference: null,
      fromStatus: null,
      toStatus: null,
      actor,
      note: null,
    });
    return { ...current, imageVersion: now, updatedAt: now, updatedBy: actor };
  });
  return toStaffItem(item);
}

/**
 * Permanently deletes an item that has NO history (never requested, no maintenance records) —
 * e.g. registered by mistake. Items with history must be deactivated instead, so records are kept.
 * The caller must type the item code to confirm. An activity entry records who deleted it.
 */
export async function deleteItem(db: Db, actor: ActorSummary, id: string, confirmItemCode: string) {
  return db.runTransaction(async (tx) => {
    const item = await tx.get<ItemDoc>(C.items, id);
    if (!item) throw notFound('Item not found (it may already have been deleted).');
    const [requests, maintenance, codeRef] = await Promise.all([
      tx.query<RequestDoc>(C.requests, { filters: [{ field: 'itemId', op: '==', value: id }] }),
      tx.query<MaintenanceDoc>(C.maintenanceLogs, { filters: [{ field: 'itemId', op: '==', value: id }] }),
      tx.get<{ itemId: string }>(C.itemCodes, item.itemCode),
    ]);

    if (confirmItemCode.trim().toUpperCase() !== item.itemCode) {
      throw new AppError(400, 'CONFIRMATION_MISMATCH', `Type the item code ${item.itemCode} exactly to confirm.`, {
        confirmItemCode: 'Does not match the item code.',
      });
    }
    if (item.status === 'On loan' || item.holdRequestId) {
      throw conflict('This item is on loan or reserved. It cannot be deleted.');
    }
    if (requests.length > 0 || maintenance.length > 0) {
      throw conflict(
        `This item has history (${requests.length} borrowing request(s), ${maintenance.length} maintenance record(s)). Deactivate it instead, so the records are kept.`,
        'HAS_HISTORY',
      );
    }

    tx.delete(C.items, id);
    tx.delete(C.itemImages, id);
    if (codeRef?.itemId === id) tx.delete(C.itemCodes, item.itemCode);
    recordActivity(tx, {
      action: 'item.deleted',
      summary: `Permanently deleted item ${item.itemCode} (${item.name})`,
      itemId: id,
      itemCode: item.itemCode,
      requestId: null,
      reference: null,
      fromStatus: item.status,
      toStatus: null,
      actor,
      note: null,
    });
    return { deleted: true, itemCode: item.itemCode };
  });
}

/** Whether an item could be deleted right now (for the admin page). */
export function deletableReason(item: ItemDoc, requestCount: number, maintenanceCount: number): string | null {
  if (item.status === 'On loan' || item.holdRequestId) return 'It is on loan or reserved.';
  if (requestCount || maintenanceCount) return 'It has borrowing or maintenance history — deactivate it instead.';
  return null;
}

export async function removeItemImage(db: Db, actor: ActorSummary, id: string) {
  const item = await db.runTransaction(async (tx) => {
    const current = await tx.get<ItemDoc>(C.items, id);
    if (!current) throw notFound('Item not found.');
    if (!current.imageVersion) return current;
    const now = nowIso();
    tx.delete(C.itemImages, id);
    tx.update(C.items, id, { imageVersion: null, updatedAt: now, updatedBy: actor });
    recordActivity(tx, {
      action: 'item.image-removed',
      summary: 'Removed the item photo',
      itemId: id,
      itemCode: current.itemCode,
      requestId: null,
      reference: null,
      fromStatus: null,
      toStatus: null,
      actor,
      note: null,
    });
    return { ...current, imageVersion: null, updatedAt: now, updatedBy: actor };
  });
  return toStaffItem(item);
}

export async function getItemImage(db: Db, id: string): Promise<{ contentType: string; bytes: Buffer } | null> {
  const img = await db.get<{ contentType: string; data: string }>(C.itemImages, id);
  if (!img) return null;
  return { contentType: img.contentType, bytes: Buffer.from(img.data, 'base64') };
}

function matchesText(item: ItemDoc, q: string): boolean {
  if (!q) return true;
  const hay = `${item.itemCode} ${item.name} ${item.category} ${item.description}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

export async function listPublicItems(db: Db, q: string, availability: string) {
  const items = await db.query<ItemDoc>(C.items, {
    filters: [{ field: 'status', op: 'in', value: ['Available', 'On loan', 'Under maintenance'] }],
    limit: MAX_LIST,
  });
  return items
    .filter((i) => matchesText(i, q))
    .map(toPublicItem)
    .filter((i) => (availability === 'available' ? i.availability.canRequest : true))
    .sort((a, b) => a.name.localeCompare(b.name) || a.itemCode.localeCompare(b.itemCode));
}

export async function getPublicItem(db: Db, id: string) {
  const item = await db.get<ItemDoc>(C.items, id);
  if (!item) throw notFound('This item could not be found. The QR code may be out of date.');
  return toPublicItem(item);
}

export async function listStaffItems(db: Db, q: string, status: string) {
  const items = await db.query<ItemDoc>(C.items, { limit: MAX_LIST });
  return items
    .filter((i) => matchesText(i, q))
    .filter((i) => {
      if (!status) return i.status !== 'Inactive';
      if (status === 'all') return true;
      if (status === 'Awaiting handover') return i.status === 'Available' && !!i.holdRequestId;
      return i.status === status;
    })
    .map(toStaffItem)
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
}

export async function getStaffItemDetail(db: Db, id: string, today: string) {
  const item = await db.get<ItemDoc>(C.items, id);
  if (!item) throw notFound('Item not found.');
  const [requests, activity, maintenance] = await Promise.all([
    db.query<RequestDoc>(C.requests, { filters: [{ field: 'itemId', op: '==', value: id }] }),
    db.query<ActivityDoc>(C.activity, { filters: [{ field: 'itemId', op: '==', value: id }] }),
    db.query<MaintenanceDoc>(C.maintenanceLogs, { filters: [{ field: 'itemId', op: '==', value: id }] }),
  ]);
  return {
    item: toStaffItem(item),
    /** null = can be deleted permanently; otherwise the reason it can't. */
    cannotDeleteReason: deletableReason(item, requests.length, maintenance.length),
    history: requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => toStaffRequest(r, today)),
    activity: activity
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 300)
      .map(toActivityEntry),
    maintenance: maintenance
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map(toMaintenanceEntry),
  };
}

export async function findItemByCode(db: Db, code: string): Promise<WithId<ItemDoc> | null> {
  const ref = await db.get<{ itemId: string }>(C.itemCodes, code.trim().toUpperCase());
  if (!ref) return null;
  return db.get<ItemDoc>(C.items, ref.itemId);
}

/**
 * Adds a maintenance record (staff only). Optionally marks an item that is Under maintenance as
 * Available in the same transaction. Submitting the same form twice creates only one entry.
 */
export async function addMaintenanceEntry(db: Db, timezone: string, actor: ActorSummary, itemId: string, input: MaintenanceInput) {
  if (input.date > todayIn(timezone)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The maintenance date cannot be in the future.', { date: 'Cannot be in the future.' });
  }
  const entryId = sha256(`maintenance:${input.clientEntryId}`).slice(0, 32);
  return db.runTransaction(async (tx) => {
    const item = await tx.get<ItemDoc>(C.items, itemId);
    if (!item) throw notFound('Item not found.');
    const existing = await tx.get<MaintenanceDoc>(C.maintenanceLogs, entryId);
    if (existing) {
      if (existing.itemId !== itemId) throw conflict('This form was already used for another item. Reload the page.');
      return { alreadyDone: true, entry: toMaintenanceEntry(existing), item: toStaffItem(item) };
    }
    let statusChange: MaintenanceDoc['statusChange'] = null;
    if (input.markAvailable) {
      if (item.status !== 'Under maintenance') {
        throw conflict(
          `Only an item that is "Under maintenance" can be marked available here (current status: ${item.status}).`,
        );
      }
      if (item.holdRequestId) throw conflict('This item is held by a request. Resolve that request first.');
      statusChange = { from: 'Under maintenance', to: 'Available' };
    }
    const now = nowIso();
    const doc: MaintenanceDoc = {
      itemId,
      itemCode: item.itemCode,
      date: input.date,
      description: input.description,
      performedBy: input.performedBy,
      statusChange,
      createdAt: now,
      createdBy: actor,
    };
    tx.set(C.maintenanceLogs, entryId, doc);
    const itemUpdate = statusChange ? { status: 'Available' as const, updatedAt: now, updatedBy: actor } : null;
    if (itemUpdate) tx.update(C.items, itemId, itemUpdate);
    recordActivity(tx, {
      action: 'item.maintenance-logged',
      summary: `Maintenance recorded for ${item.itemCode} (${input.date})${statusChange ? '. Item is now Available.' : ''}`,
      itemId,
      itemCode: item.itemCode,
      requestId: null,
      reference: null,
      fromStatus: statusChange?.from ?? null,
      toStatus: statusChange?.to ?? null,
      actor,
      note: null,
    });
    return {
      alreadyDone: false,
      entry: toMaintenanceEntry({ ...doc, id: entryId }),
      item: toStaffItem(itemUpdate ? { ...item, ...itemUpdate } : item),
    };
  });
}
