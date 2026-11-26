// Types and constants shared by the browser app and the backend functions.
// Nothing in this file may contain secrets.

export const ITEM_STATUSES = ['Available', 'On loan', 'Under maintenance', 'Inactive'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const REQUEST_STATUSES = [
  'Pending',
  'Approved',
  'Rejected',
  'On loan',
  'Return requested',
  'Returned',
  'Cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Requests that are still "in progress" and block deactivating their item. */
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = ['Pending', 'Approved', 'On loan', 'Return requested'];
/** Requests where the borrower physically has the item. */
export const ACTIVE_LOAN_STATUSES: readonly RequestStatus[] = ['On loan', 'Return requested'];

export const STAFF_REQUEST_ACTIONS = ['approve', 'reject', 'cancel', 'handover', 'confirm-return'] as const;
export type StaffRequestAction = (typeof STAFF_REQUEST_ACTIONS)[number];

export type ReturnCondition = 'good' | 'needs-maintenance';

export type BackendMode = 'firebase' | 'memory';

export interface AppConfig {
  mode: BackendMode;
  /** Base URL used in QR codes and tracking links. null = not configured (browser origin is used). */
  publicBaseUrl: string | null;
  timezone: string;
  today: string;
  /** Server-side Firebase project ID (firebase mode only). Not secret. */
  firebaseProjectId: string | null;
  /** Passwordless local test sign-in is on (local development only). */
  devStaffLogin: boolean;
  /** Only present when devStaffLogin is on. */
  devStaffEmails?: string[];
  devAdminEmails?: string[];
  /** `npm run dev:lan`: test sign-in is also accepted from devices on the same private Wi-Fi, with a passcode. */
  devLanLogin?: boolean;
}

export type UserRole = 'admin' | 'staff';
export type UserStatus = 'active' | 'pending' | 'blocked';

/** Departments a staff member can belong to (shown as a dropdown in the profile). */
export const DEPARTMENTS = [
  'Rubix Technology',
  'Asiah Hisam (Litigation)',
  'Asiah Hisam (Conveyancing)',
  'Ana Travel',
  'AFC Mortgage',
  'SANCO',
] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** Details a staff member fills in about themselves. Email comes from the admin's registration. */
export interface UserProfile {
  fullName: string;
  phone: string;
  department: Department | '';
}

/** The signed-in person, as returned by /api/me. */
export interface Me {
  uid: string;
  email: string | null;
  name: string | null;
  photoUrl: string | null;
  role: UserRole;
  status: UserStatus;
  /** Signed in with the local passwordless test sign-in (development only). */
  localTest: boolean;
  profile: UserProfile;
  /** Staff must complete their profile before using the system. */
  profileComplete: boolean;
}

/** A user account as admins see it on the Users page. */
export interface UserAccount {
  uid: string;
  email: string | null;
  name: string | null;
  photoUrl: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  lastSeenAt: string | null;
  updatedAt: string;
  updatedBy: ActorSummary | null;
  profile: UserProfile;
  profileComplete: boolean;
}

/** An account an admin has registered, waiting for the person's first Google sign-in. */
export interface UserInvite {
  email: string;
  role: UserRole;
  invitedAt: string;
  invitedBy: ActorSummary | null;
}

export interface PublicAvailability {
  /** Customer-facing text such as "Available" or "Not available right now". */
  label: string;
  canRequest: boolean;
}

/** Item data safe to show anyone. Never includes condition notes or borrower data. */
export interface PublicItem {
  id: string;
  itemCode: string;
  name: string;
  description: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  imageUrl: string | null;
  status: ItemStatus;
  availability: PublicAvailability;
}

/** Staff-only maintenance record. Entries are never edited or deleted. */
export interface MaintenanceEntry {
  id: string;
  itemId: string;
  itemCode: string;
  /** YYYY-MM-DD the work was done. */
  date: string;
  description: string;
  performedBy: string;
  /** Item status set together with this entry (e.g. "Available" when work finished), if any. */
  statusChange: { from: ItemStatus; to: ItemStatus } | null;
  createdAt: string;
  createdBy: ActorSummary;
}

export interface ActorSummary {
  /** 'customer' only appears on records created before sign-in was required. */
  type: 'staff' | 'admin' | 'customer' | 'system';
  uid?: string;
  email?: string | null;
  name?: string | null;
}

export interface StaffItem extends PublicItem {
  conditionNotes: string;
  serialNumber: string;
  location: string;
  purchaseDate: string;
  warrantyExpiry: string;
  externalImageUrl: string | null;
  hasUploadedImage: boolean;
  holdRequestId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: ActorSummary | null;
  updatedBy: ActorSummary | null;
}

/** What a borrower sees about their own request. No private admin notes. */
export interface MyRequestView {
  id: string;
  reference: string;
  status: RequestStatus;
  statusExplanation: string;
  item: { id: string; itemCode: string; name: string; imageUrl: string | null };
  department: string;
  phone: string;
  requestedDate: string;
  expectedReturnDate: string;
  customerNotes: string;
  customerMessage: string;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  handoverAt: string | null;
  returnRequestedAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  overdue: boolean;
  canRequestReturn: boolean;
  canCancel: boolean;
}

export interface StaffRequest {
  id: string;
  reference: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  /** Account of the person borrowing (null on records created before sign-in was required). */
  borrowerUid: string | null;
  customerName: string;
  department: string;
  phone: string;
  email: string | null;
  requestedDate: string;
  expectedReturnDate: string;
  customerNotes: string;
  staffNotes: string;
  customerMessage: string;
  status: RequestStatus;
  overdue: boolean;
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
}

export interface ActivityEntry {
  id: string;
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
}

export interface DashboardSummary {
  counts: {
    availableItems: number;
    activeLoans: number;
    pendingRequests: number;
    overdueLoans: number;
    awaitingHandover: number;
    returnRequested: number;
    underMaintenance: number;
  };
  pending: StaffRequest[];
  awaitingHandover: StaffRequest[];
  returnRequested: StaffRequest[];
  overdue: StaffRequest[];
}

export interface StaffMe {
  uid: string;
  email: string | null;
  name: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export const REQUEST_STATUS_EXPLANATIONS: Record<RequestStatus, string> = {
  Pending: 'Your request has been received and is waiting for an admin to review it. The item is not reserved yet.',
  Approved:
    'Your request has been approved. The item has not been handed over yet — an admin will hand it to you.',
  Rejected: 'Your request was not approved.',
  'On loan': 'You have this item. Please return it by the expected return date.',
  'Return requested':
    'You told us you are returning this item. An admin will inspect it and confirm receipt. Until then, the loan is still open.',
  Returned: 'An admin confirmed the item was returned. This loan is closed.',
  Cancelled: 'This request was cancelled.',
};

/** A short-lived QR code an admin shows to hand an item over in person. */
export interface HandoverCode {
  /** Secret code (only shown on the admin's screen, inside the QR). */
  code: string;
  expiresAt: string;
}

/** What the borrower sees after scanning a handover QR, before confirming. */
export interface HandoverPreview {
  request: MyRequestView;
  expiresAt: string;
  adminName: string;
}
