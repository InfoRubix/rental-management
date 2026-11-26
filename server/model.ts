import {
  ACTIVE_LOAN_STATUSES,
  DEPARTMENTS,
  REQUEST_STATUS_EXPLANATIONS,
  type ActivityEntry,
  type Department,
  type UserProfile,
  type ActorSummary,
  type MyRequestView,
  type UserAccount,
  type UserRole,
  type UserStatus,
  type ItemStatus,
  type MaintenanceEntry,
  type PublicItem,
  type RequestStatus,
  type ReturnCondition,
  type StaffItem,
  type StaffRequest,
} from '../shared/types';
import type { WithId } from './db/types';

// Firestore collection names.
export const C = {
  items: 'items',
  itemCodes: 'itemCodes', // doc id = item code; guarantees unique codes
  itemImages: 'itemImages',
  requests: 'requests',
  requestRefs: 'requestRefs', // doc id = reference; guarantees unique references
  submissionKeys: 'submissionKeys', // idempotency for public form submissions
  activity: 'activity',
  maintenanceLogs: 'maintenanceLogs', // staff-only maintenance records
  users: 'users', // one document per Google account (doc id = Firebase uid)
  userInvites: 'userInvites', // doc id = lower-case email; accounts an admin registered, before first sign-in
  rateLimits: 'rateLimits',
  handoverCodes: 'handoverCodes', // doc id = sha256(code); short-lived, single-use QR handover codes
} as const;

export interface ItemDoc {
  itemCode: string;
  name: string;
  nameLower: string;
  description: string;
  category: string;
  conditionNotes: string; // staff only
  externalImageUrl: string;
  // Added later; older documents may not have them.
  brand?: string;
  model?: string;
  serialNumber?: string; // staff only
  location?: string; // staff only
  purchaseDate?: string; // staff only
  warrantyExpiry?: string; // staff only
  imageVersion: string | null; // set when a photo is uploaded
  status: ItemStatus;
  /** The request currently holding the item (Approved, On loan or Return requested). */
  holdRequestId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: ActorSummary | null;
  updatedBy: ActorSummary | null;
  sample?: boolean;
  [key: string]: unknown;
}

export interface RequestDoc {
  reference: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  /** Firebase uid of the borrower. Missing on records created before sign-in was required. */
  borrowerUid?: string | null;
  customerName: string;
  department?: string;
  phone: string;
  phoneKey: string;
  email: string | null;
  requestedDate: string;
  expectedReturnDate: string;
  customerNotes: string;
  staffNotes: string; // staff only
  customerMessage: string; // written by staff, shown to the customer
  status: RequestStatus;
  /** Only on records created before sign-in was required (old private tracking links). */
  tokenHash?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  approvedBy: ActorSummary | null;
  rejectedAt: string | null;
  rejectedBy: ActorSummary | null;
  handoverAt: string | null;
  handoverBy: ActorSummary | null;
  returnRequestedAt: string | null;
  returnedAt: string | null;
  returnedBy: ActorSummary | null;
  returnCondition: ReturnCondition | null;
  cancelledAt: string | null;
  cancelledBy: ActorSummary | null;
  sample?: boolean;
  [key: string]: unknown;
}

export interface MaintenanceDoc {
  itemId: string;
  itemCode: string;
  date: string;
  description: string;
  performedBy: string;
  statusChange: { from: ItemStatus; to: ItemStatus } | null;
  createdAt: string;
  createdBy: ActorSummary;
  [key: string]: unknown;
}

export function toMaintenanceEntry(m: WithId<MaintenanceDoc>): MaintenanceEntry {
  return {
    id: m.id,
    itemId: m.itemId,
    itemCode: m.itemCode,
    date: m.date,
    description: m.description,
    performedBy: m.performedBy,
    statusChange: m.statusChange ?? null,
    createdAt: m.createdAt,
    createdBy: m.createdBy,
  };
}

export interface ActivityDoc {
  at: string;
  action: string;
  summary: string;
  itemId: string | null;
  itemCode: string | null;
  requestId: string | null;
  reference: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  actor: ActorSummary;
  note: string | null;
  [key: string]: unknown;
}

export function itemImageUrl(item: WithId<ItemDoc>): string | null {
  if (item.imageVersion) return `/api/items/${item.id}/image?v=${encodeURIComponent(item.imageVersion)}`;
  return item.externalImageUrl || null;
}

export function publicAvailability(item: ItemDoc): PublicItem['availability'] {
  switch (item.status) {
    case 'Available':
      return item.holdRequestId
        ? { label: 'Not available right now', canRequest: false }
        : { label: 'Available', canRequest: true };
    case 'On loan':
      return { label: 'On loan', canRequest: false };
    case 'Under maintenance':
      return { label: 'Under maintenance', canRequest: false };
    default:
      return { label: 'Not available for borrowing', canRequest: false };
  }
}

/** Whitelist serializer: only fields that are safe for anyone who scans the QR code. */
export function toPublicItem(item: WithId<ItemDoc>): PublicItem {
  return {
    id: item.id,
    itemCode: item.itemCode,
    name: item.name,
    description: item.description,
    category: item.category || null,
    brand: item.brand || null,
    model: item.model || null,
    imageUrl: itemImageUrl(item),
    status: item.status,
    availability: publicAvailability(item),
  };
}

export function toStaffItem(item: WithId<ItemDoc>): StaffItem {
  return {
    ...toPublicItem(item),
    conditionNotes: item.conditionNotes,
    serialNumber: item.serialNumber ?? '',
    location: item.location ?? '',
    purchaseDate: item.purchaseDate ?? '',
    warrantyExpiry: item.warrantyExpiry ?? '',
    externalImageUrl: item.externalImageUrl || null,
    hasUploadedImage: !!item.imageVersion,
    holdRequestId: item.holdRequestId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdBy: item.createdBy,
    updatedBy: item.updatedBy,
  };
}

export function isOverdue(req: RequestDoc, today: string): boolean {
  return ACTIVE_LOAN_STATUSES.includes(req.status) && req.expectedReturnDate < today;
}

export function toStaffRequest(req: WithId<RequestDoc>, today: string): StaffRequest {
  return {
    id: req.id,
    reference: req.reference,
    itemId: req.itemId,
    itemCode: req.itemCode,
    itemName: req.itemName,
    borrowerUid: req.borrowerUid ?? null,
    department: req.department ?? '',
    customerName: req.customerName,
    phone: req.phone,
    email: req.email,
    requestedDate: req.requestedDate,
    expectedReturnDate: req.expectedReturnDate,
    customerNotes: req.customerNotes,
    staffNotes: req.staffNotes,
    customerMessage: req.customerMessage,
    status: req.status,
    overdue: isOverdue(req, today),
    createdAt: req.createdAt,
    updatedAt: req.updatedAt,
    approvedAt: req.approvedAt,
    approvedBy: req.approvedBy,
    rejectedAt: req.rejectedAt,
    rejectedBy: req.rejectedBy,
    handoverAt: req.handoverAt,
    handoverBy: req.handoverBy,
    returnRequestedAt: req.returnRequestedAt,
    returnedAt: req.returnedAt,
    returnedBy: req.returnedBy,
    returnCondition: req.returnCondition,
    cancelledAt: req.cancelledAt,
    cancelledBy: req.cancelledBy,
  };
}

/** Whitelist serializer for a borrower viewing their OWN request. No private admin notes or admin identities. */
export function toMyRequestView(req: WithId<RequestDoc>, item: WithId<ItemDoc> | null, today: string): MyRequestView {
  return {
    id: req.id,
    reference: req.reference,
    status: req.status,
    statusExplanation: REQUEST_STATUS_EXPLANATIONS[req.status],
    item: {
      id: req.itemId,
      itemCode: req.itemCode,
      name: req.itemName,
      imageUrl: item ? itemImageUrl(item) : null,
    },
    department: req.department ?? '',
    phone: req.phone,
    requestedDate: req.requestedDate,
    expectedReturnDate: req.expectedReturnDate,
    customerNotes: req.customerNotes,
    customerMessage: req.customerMessage,
    createdAt: req.createdAt,
    approvedAt: req.approvedAt,
    rejectedAt: req.rejectedAt,
    handoverAt: req.handoverAt,
    returnRequestedAt: req.returnRequestedAt,
    returnedAt: req.returnedAt,
    cancelledAt: req.cancelledAt,
    overdue: isOverdue(req, today),
    canRequestReturn: req.status === 'On loan',
    canCancel: req.status === 'Pending' || req.status === 'Approved',
  };
}

export interface UserDoc {
  email: string | null;
  name: string | null;
  photoUrl: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  lastSeenAt: string | null;
  updatedAt: string;
  updatedBy: ActorSummary | null;
  /** Filled in by the person on their profile page. */
  fullName?: string;
  phone?: string;
  department?: string;
  [key: string]: unknown;
}

export interface UserInviteDoc {
  email: string;
  role: UserRole;
  invitedAt: string;
  invitedBy: ActorSummary | null;
  [key: string]: unknown;
}

export function profileOf(u: Pick<UserDoc, 'fullName' | 'phone' | 'department'>): UserProfile {
  const department = (DEPARTMENTS as readonly string[]).includes(u.department ?? '') ? (u.department as Department) : '';
  return { fullName: u.fullName ?? '', phone: u.phone ?? '', department };
}

export function isProfileComplete(p: UserProfile): boolean {
  return p.fullName.trim().length >= 2 && p.phone.trim().length >= 7 && p.department !== '';
}

export function toUserAccount(u: WithId<UserDoc>): UserAccount {
  const profile = profileOf(u);
  return {
    uid: u.id,
    email: u.email,
    name: u.name,
    photoUrl: u.photoUrl ?? null,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    lastSeenAt: u.lastSeenAt ?? null,
    updatedAt: u.updatedAt,
    updatedBy: u.updatedBy ?? null,
    profile,
    profileComplete: isProfileComplete(profile),
  };
}

export function toActivityEntry(a: WithId<ActivityDoc>): ActivityEntry {
  return {
    id: a.id,
    at: a.at,
    action: a.action,
    summary: a.summary,
    itemId: a.itemId,
    itemCode: a.itemCode,
    requestId: a.requestId,
    reference: a.reference,
    fromStatus: a.fromStatus,
    toStatus: a.toStatus,
    actor: a.actor,
    note: a.note,
  };
}
