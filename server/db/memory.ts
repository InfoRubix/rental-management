import type { Db, DocData, QueryOptions, Tx, WithId } from './types';

/**
 * DEVELOPMENT/TEST ONLY. Data lives in the server process memory and is lost on restart.
 * Transactions are serialised (one at a time) and writes are applied only when the
 * transaction function finishes successfully, so a failed transaction changes nothing.
 */
type Store = Map<string, Map<string, DocData>>;

const clone = <T>(v: T): T => structuredClone(v);

function matches(doc: DocData, options: QueryOptions): boolean {
  for (const f of options.filters ?? []) {
    const v = doc[f.field];
    if (f.op === '==' && v !== f.value) return false;
    if (f.op === 'in' && !(Array.isArray(f.value) && f.value.includes(v))) return false;
  }
  return true;
}

function runQuery(store: Store, collection: string, options: QueryOptions): WithId<DocData>[] {
  const col = store.get(collection);
  if (!col) return [];
  let rows: WithId<DocData>[] = [...col.entries()].filter(([, d]) => matches(d, options)).map(([id, d]) => ({ ...clone(d), id }));
  if (options.orderBy) {
    const { field, direction } = options.orderBy;
    rows.sort((a, b) => {
      const av = String(a[field] ?? '');
      const bv = String(b[field] ?? '');
      return direction === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }
  if (options.limit) rows = rows.slice(0, options.limit);
  return rows;
}

export class MemoryDb implements Db {
  private store: Store = new Map();
  private queue: Promise<unknown> = Promise.resolve();

  async get<T extends DocData>(collection: string, id: string): Promise<WithId<T> | null> {
    const d = this.store.get(collection)?.get(id);
    return d ? ({ ...clone(d), id } as WithId<T>) : null;
  }

  async query<T extends DocData>(collection: string, options: QueryOptions): Promise<WithId<T>[]> {
    return runQuery(this.store, collection, options) as WithId<T>[];
  }

  runTransaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    const run = async () => {
      const writes: Array<() => void> = [];
      let wrote = false;
      const assertReadable = () => {
        if (wrote) throw new Error('Transaction reads must happen before writes (Firestore rule).');
      };
      const col = (name: string) => {
        let c = this.store.get(name);
        if (!c) {
          c = new Map();
          this.store.set(name, c);
        }
        return c;
      };
      const tx: Tx = {
        get: async (collection, id) => {
          assertReadable();
          return this.get(collection, id);
        },
        query: async (collection, options) => {
          assertReadable();
          return this.query(collection, options);
        },
        set: (collection, id, data) => {
          wrote = true;
          const copy = clone(data);
          writes.push(() => col(collection).set(id, copy));
        },
        update: (collection, id, data) => {
          wrote = true;
          const copy = clone(data);
          writes.push(() => {
            const existing = col(collection).get(id);
            if (!existing) throw new Error(`Cannot update missing document ${collection}/${id}`);
            col(collection).set(id, { ...existing, ...copy });
          });
        },
        delete: (collection, id) => {
          wrote = true;
          writes.push(() => col(collection).delete(id));
        },
      };
      const result = await fn(tx);
      for (const w of writes) w();
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Test helper. */
  countDocs(collection: string): number {
    return this.store.get(collection)?.size ?? 0;
  }
}
