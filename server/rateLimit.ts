import type { Db } from './db/types';
import { AppError } from './errors';
import { sha256 } from './util';

export interface RateRule {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_RULES = {
  /** Borrow requests per signed-in user. */
  submitRequest: { bucket: 'submit', limit: 10, windowSeconds: 15 * 60 },
  /** Return / cancel actions per signed-in user. */
  userAction: { bucket: 'user-action', limit: 20, windowSeconds: 10 * 60 },
  /** Public item photo requests per IP. */
  publicRead: { bucket: 'public-read', limit: 300, windowSeconds: 60 },
} satisfies Record<string, RateRule>;

interface RateDoc {
  windowStart: number;
  count: number;
  expireAt: Date;
  [key: string]: unknown;
}

/**
 * Fixed-window rate limit per key (client IP or user ID), stored in the database so it works across
 * serverless function instances. Keys are hashed; raw IPs are never stored.
 */
export async function enforceRateLimit(db: Db, rule: RateRule, key: string): Promise<void> {
  const docId = sha256(`${rule.bucket}:${key}`).slice(0, 40);
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const allowed = await db.runTransaction(async (tx) => {
    const doc = await tx.get<RateDoc>('rateLimits', docId);
    if (!doc || now - doc.windowStart >= windowMs) {
      tx.set('rateLimits', docId, { windowStart: now, count: 1, expireAt: new Date(now + windowMs) });
      return true;
    }
    if (doc.count >= rule.limit) return false;
    tx.update('rateLimits', docId, { count: doc.count + 1 });
    return true;
  });
  if (!allowed) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.');
  }
}

/**
 * Fast in-memory fixed-window limit (per server instance, no database round trip). Used for cheap public
 * reads such as item photos, where a database write per request would cost more than the request itself.
 */
const memoryWindows = new Map<string, { start: number; count: number }>();
export function enforceMemoryRateLimit(rule: RateRule, key: string): void {
  const id = `${rule.bucket}:${key}`;
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const w = memoryWindows.get(id);
  if (!w || now - w.start >= windowMs) {
    if (memoryWindows.size > 10_000) memoryWindows.clear();
    memoryWindows.set(id, { start: now, count: 1 });
    return;
  }
  if (++w.count > rule.limit) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.');
  }
}
