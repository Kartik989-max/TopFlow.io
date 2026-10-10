import type { Collection, Document, Filter, UpdateFilter } from 'mongodb';
import { getCollection } from './mongo.js';
import logger from '../utils/logger.js';

export interface WriteResult {
  matched: number;
  modified: number;
  upserted: number;
}

export abstract class BaseRepository<T extends Document> {
  protected abstract collectionName: string;

  protected get collection(): Collection<T> {
    return getCollection<T>(this.collectionName);
  }

  async findOne(filter: Filter<T>): Promise<T | null> {
    return this.collection.findOne(filter) as Promise<T | null>;
  }

  async findMany(
    filter: Filter<T> = {},
    opts: { sort?: Record<string, 1 | -1>; limit?: number } = {},
  ) {
    let q = this.collection.find(filter);
    if (opts.sort) q = q.sort(opts.sort as Record<string, 1 | -1>);
    if (opts.limit) q = q.limit(opts.limit);
    return q.toArray();
  }

  async upsertOne(filter: Filter<T>, update: UpdateFilter<T>): Promise<WriteResult> {
    const res = await this.collection.updateOne(filter, update, { upsert: true });
    return {
      matched: res.matchedCount,
      modified: res.modifiedCount,
      upserted: res.upsertedId ? 1 : 0,
    };
  }

  async count(filter: Filter<T> = {}): Promise<number> {
    return this.collection.countDocuments(filter);
  }

  async insertManyIgnoreDup(docs: T[]): Promise<{ inserted: number; errors: number }> {
    if (docs.length === 0) return { inserted: 0, errors: 0 };
    try {
      const res = await this.collection.insertMany(docs as any[], { ordered: false });
      return { inserted: Object.keys(res.insertedIds).length, errors: 0 };
    } catch (err: any) {
      const isDup = err?.code === 11000;
      const inserted = err?.result?.insertedDocs ? Object.keys(err.result.insertedDocs).length : 0;
      logger.warn({ collection: this.collectionName, isDup, inserted }, 'insertMany partial');
      return { inserted, errors: isDup ? 0 : 1 };
    }
  }

  async distinct(field: string, filter: Filter<T> = {}): Promise<any[]> {
    return this.collection.distinct(field, filter);
  }
}
