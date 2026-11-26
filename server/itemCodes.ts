import type { Db, Tx } from './db/types';
import { AppError } from './errors';

/**
 * Automatic item codes: PREFIX-NNN, e.g. "Projector 001" → PROJ-001, PROJ-002, …
 * The prefix comes from the first word of the name (letters/digits only, max 4 characters).
 * A counter per prefix lives in `itemCodeCounters`; codes typed in by hand are skipped over.
 */
export const COUNTERS = 'itemCodeCounters';
const MAX_SKIPS = 50;

export function codePrefix(name: string): string {
  const words = name
    .replace(/\[[^\]]*\]/g, ' ') // ignore bracketed tags such as "[SAMPLE]"
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[A-Z]/.test(w)); // skip pure numbers like "001"
  const prefix = (words[0] ?? '').replace(/[^A-Z0-9]/g, '').slice(0, 4);
  return prefix.length >= 2 ? prefix : 'ITEM';
}

export function formatCode(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

/** Finds the next free code. Reads only, so it can run at the start of a transaction. */
async function findFree(reader: Pick<Tx, 'get'>, name: string) {
  const prefix = codePrefix(name);
  const counter = await reader.get<{ next: number }>(COUNTERS, prefix);
  let n = counter?.next ?? 1;
  for (let i = 0; i < MAX_SKIPS; i++, n++) {
    const code = formatCode(prefix, n);
    if (!(await reader.get('itemCodes', code))) return { prefix, code, n };
  }
  throw new AppError(409, 'NO_FREE_CODE', 'Could not find a free item code automatically. Please type one in.');
}

/** Inside a transaction: reserves the next free code (call before any writes in that transaction). */
export async function reserveNextCode(tx: Tx, name: string) {
  const found = await findFree(tx, name);
  return { code: found.code, commit: () => tx.set(COUNTERS, found.prefix, { next: found.n + 1 }) };
}

/** Preview for the form. Does not reserve anything, so the saved code may differ if someone else saves first. */
export async function previewNextCode(db: Db, name: string): Promise<string> {
  return (await findFree(db, name)).code;
}
