import type { Firestore, Query, Transaction } from 'firebase-admin/firestore';
import type { Db, DocData, QueryOptions, Tx, WithId } from './types';

function buildQuery(fs: Firestore, collection: string, options: QueryOptions): Query {
  let q: Query = fs.collection(collection);
  for (const f of options.filters ?? []) q = q.where(f.field, f.op, f.value);
  if (options.orderBy) q = q.orderBy(options.orderBy.field, options.orderBy.direction);
  if (options.limit) q = q.limit(options.limit);
  return q;
}

export class FirestoreDb implements Db {
  constructor(private fs: Firestore) {}

  async get<T extends DocData>(collection: string, id: string): Promise<WithId<T> | null> {
    const snap = await this.fs.collection(collection).doc(id).get();
    return snap.exists ? ({ ...(snap.data() as T), id: snap.id } as WithId<T>) : null;
  }

  async query<T extends DocData>(collection: string, options: QueryOptions): Promise<WithId<T>[]> {
    const snap = await buildQuery(this.fs, collection, options).get();
    return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }) as WithId<T>);
  }

  runTransaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    return this.fs.runTransaction(async (t: Transaction) => {
      const tx: Tx = {
        get: async <T extends DocData>(collection: string, id: string) => {
          const snap = await t.get(this.fs.collection(collection).doc(id));
          return snap.exists ? ({ ...(snap.data() as T), id: snap.id } as WithId<T>) : null;
        },
        query: async <T extends DocData>(collection: string, options: QueryOptions) => {
          const snap = await t.get(buildQuery(this.fs, collection, options));
          return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }) as WithId<T>);
        },
        set: (collection, id, data) => void t.set(this.fs.collection(collection).doc(id), data),
        update: (collection, id, data) => void t.update(this.fs.collection(collection).doc(id), data),
        delete: (collection, id) => void t.delete(this.fs.collection(collection).doc(id)),
      };
      return fn(tx);
    });
  }
}
