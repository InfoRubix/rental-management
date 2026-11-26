import type { Tx } from '../db/types';
import { C, type ActivityDoc } from '../model';
import { newId, nowIso } from '../util';

/** Activity is written inside the same transaction as the change it describes, so it is never duplicated or lost. */
export function recordActivity(tx: Tx, entry: Omit<ActivityDoc, 'at'> & { at?: string }): void {
  tx.set(C.activity, newId(), { ...entry, at: entry.at ?? nowIso() });
}
