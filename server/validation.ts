import { z } from 'zod';
import { DEPARTMENTS } from '../shared/types';
import { badRequest } from './errors';

const trimmed = (max: number) => z.string().trim().max(max, `Must be ${max} characters or fewer.`);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker (YYYY-MM-DD).')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), {
    message: 'Not a real date.',
  });

export const itemCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/, 'Use 2–32 letters, numbers, "-" or "_" (example: PROJ-001).');

const httpsUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((s) => {
    try {
      return new URL(s).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be an https:// link to an image.');

const phoneSchema = z
  .string()
  .trim()
  .max(25)
  .regex(/^\+?[0-9\s\-()]{7,25}$/, 'Enter a valid phone number (digits, spaces, +, - only).')
  .refine((s) => s.replace(/\D/g, '').length >= 7, 'Enter a valid phone number.');

/** A staff member's own profile. Email is not editable here (it comes from the admin's registration). */
export const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  phone: phoneSchema,
  department: z.enum(DEPARTMENTS, { message: 'Choose your department.' }),
});

/** Admin registers a person by email. */
export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email('Enter a valid email address.'),
  role: z.enum(['admin', 'staff']).default('staff'),
});

/** Borrow request from a signed-in user. Name and email come from their Google account, not the form. */
export const createRequestSchema = z.object({
  itemId: z.string().trim().min(1).max(64),
  department: trimmed(100).min(2, 'Enter your department or branch.'),
  phone: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .max(25)
        .regex(/^\+?[0-9\s\-()]{7,25}$/, 'Enter a valid phone number (digits, spaces, +, - only).')
        .refine((s) => s.replace(/\D/g, '').length >= 7, 'Enter a valid phone number.'),
    ])
    .optional()
    .default(''),
  requestedDate: isoDate,
  expectedReturnDate: isoDate,
  customerNotes: trimmed(1000).optional().default(''),
  /** Random ID created by the browser per form; makes repeated submissions harmless. */
  clientRequestId: z.string().uuid('Invalid form. Please reload the page.'),
});

/** Admin changes a user's role and/or account status. */
export const userUpdateSchema = z
  .object({
    role: z.enum(['admin', 'staff']).optional(),
    status: z.enum(['active', 'pending', 'blocked']).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, { message: 'Nothing to change.' });

const optionalDate = z.union([z.literal(''), isoDate]);

/** Item fields without defaults (used for edits, so fields that are not sent stay unchanged). */
const itemFields = {
  itemCode: itemCodeSchema,
  name: trimmed(120).min(1, 'Name is required.'),
  description: trimmed(4000),
  category: trimmed(60),
  conditionNotes: trimmed(4000),
  externalImageUrl: z.union([z.literal(''), httpsUrl]),
  brand: trimmed(80),
  model: trimmed(80),
  serialNumber: trimmed(80),
  location: trimmed(120),
  purchaseDate: optionalDate,
  warrantyExpiry: optionalDate,
};

export const itemInputSchema = z.object({
  // Optional when registering: leave blank and the server generates one (e.g. PROJ-001).
  itemCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine((s) => s === '' || /^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(s), {
      message: 'Use 2–32 letters, numbers, "-" or "_" (example: PROJ-001), or leave blank to generate one.',
    })
    .optional()
    .default(''),
  name: itemFields.name,
  description: itemFields.description.optional().default(''),
  category: itemFields.category.optional().default(''),
  conditionNotes: itemFields.conditionNotes.optional().default(''),
  externalImageUrl: itemFields.externalImageUrl.optional().default(''),
  brand: itemFields.brand.optional().default(''),
  model: itemFields.model.optional().default(''),
  serialNumber: itemFields.serialNumber.optional().default(''),
  location: itemFields.location.optional().default(''),
  purchaseDate: itemFields.purchaseDate.optional().default(''),
  warrantyExpiry: itemFields.warrantyExpiry.optional().default(''),
});

// No defaults here: a partial edit must never blank out fields it did not send.
export const itemPatchSchema = z.object(itemFields).partial();

export const maintenanceSchema = z.object({
  date: isoDate,
  description: trimmed(2000).min(3, 'Describe what was done.'),
  performedBy: trimmed(120).optional().default(''),
  /** Item is Under maintenance and the work is finished: also make it Available, in the same step. */
  markAvailable: z.boolean().optional().default(false),
  /** Random ID created by the browser per form, so double-clicks don't create duplicate entries. */
  clientEntryId: z.string().uuid('Invalid form. Please reload the page.'),
});

export const itemStatusSchema = z.object({
  status: z.enum(['Available', 'Under maintenance', 'Inactive']),
  note: trimmed(1000).optional().default(''),
});

export const imageUploadSchema = z.object({
  dataUrl: z.string().max(800_000, 'Image is too large. Use a photo under 500 KB.'),
});

export const requestActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'cancel', 'handover', 'confirm-return']),
  note: trimmed(1000).optional().default(''),
  customerMessage: trimmed(1000).optional(),
  condition: z.enum(['good', 'needs-maintenance']).optional(),
  conditionNotes: trimmed(2000).optional().default(''),
});

export const requestPatchSchema = z.object({
  staffNotes: trimmed(4000).optional(),
  customerMessage: trimmed(1000).optional(),
});

/** Parses input and converts zod errors into a friendly 400 response with per-field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw badRequest('Please check the highlighted fields.', fields);
}

/** Permanent delete: the admin must type the item's code to confirm. */
export const itemDeleteSchema = z.object({
  confirmItemCode: z.string().trim().min(1, 'Type the item code to confirm.').max(40),
});
