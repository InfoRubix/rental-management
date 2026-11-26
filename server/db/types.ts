/**
 * A deliberately small database interface. Business logic only uses these calls, so it
 * runs the same against Firestore and against the in-memory development store.
 *
 * Rules (mirroring Firestore transactions):
 *  - inside a transaction, all reads must happen before any write;
 *  - a transaction may be retried, so its function must not have side effects
 *    other than through `tx`.
 */
export type DocData = Record<string, unknown>;
export type WithId<T> = T & { id: string };

export interface Filter {
  field: string;
  op: '==' | 'in';
  value: unknown;
}

export interface QueryOptions {
  filters?: Filter[];
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
}

export interface Tx {
  get<T extends DocData>(collection: string, id: string): Promise<WithId<T> | null>;
  query<T extends DocData>(collection: string, options: QueryOptions): Promise<WithId<T>[]>;
  set(collection: string, id: string, data: DocData): void;
  update(collection: string, id: string, data: DocData): void;
  delete(collection: string, id: string): void;
}

export interface Db {
  get<T extends DocData>(collection: string, id: string): Promise<WithId<T> | null>;
  query<T extends DocData>(collection: string, options: QueryOptions): Promise<WithId<T>[]>;
  runTransaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R>;
}
