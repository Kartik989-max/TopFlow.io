import { type Filter, type Collection } from 'mongodb';
import { BaseRepository } from './BaseRepository.js';
import { type MarketSnapshotDoc, MARKET_SNAPSHOT_COLLECTION } from '../models/MarketSnapshot.js';

export class SnapshotRepository extends BaseRepository<MarketSnapshotDoc> {
  protected collectionName = MARKET_SNAPSHOT_COLLECTION;

  get collectionRef(): Collection<MarketSnapshotDoc> {
    return this.collection;
  }

  // Idempotent by natural key {tradingDate, timestamp, symbol}.
  async upsert(snapshot: Omit<MarketSnapshotDoc, '_id'>): Promise<void> {
    const filter: Filter<MarketSnapshotDoc> = {
      tradingDate: snapshot.tradingDate,
      timestamp: snapshot.timestamp,
      symbol: snapshot.symbol,
    };
    await this.collection.updateOne(
      filter,
      { $set: snapshot },
      { upsert: true },
    );
  }

  async upsertMany(snapshots: Omit<MarketSnapshotDoc, '_id'>[]): Promise<number> {
    if (snapshots.length === 0) return 0;
    const ops = snapshots.map((s) => ({
      updateOne: {
        filter: {
          tradingDate: s.tradingDate,
          timestamp: s.timestamp,
          symbol: s.symbol,
        },
        update: { $set: s },
        upsert: true,
      },
    }));
    const res = await this.collection.bulkWrite(ops, { ordered: false });
    return res.upsertedCount ?? snapshots.length;
  }

  async countForDate(tradingDate: string): Promise<number> {
    return this.collection.countDocuments({ tradingDate });
  }

  async findLatestBySymbol(tradingDate: string, symbol: string): Promise<MarketSnapshotDoc | null> {
    return this.collection.findOne(
      { tradingDate, symbol },
      { sort: { timestamp: -1 } },
    );
  }

  async findLatestForSession(
    tradingDate: string,
    at: Date,
  ): Promise<MarketSnapshotDoc[]> {
    return this.collection
      .find({ tradingDate, timestamp: { $lte: at } })
      .sort({ timestamp: -1 })
      .toArray();
  }

  // Returns the latest snapshot per symbol at or before `at`.
  async findLatestPerSymbol(tradingDate: string, at: Date): Promise<Map<string, MarketSnapshotDoc>> {
    // Aggregation: filter up to `at`, sort by timestamp desc, group by symbol.
    const docs = await this.collection
      .aggregate([
        { $match: { tradingDate, timestamp: { $lte: at } } },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$symbol',
            doc: { $first: '$$ROOT' },
          },
        },
      ])
      .toArray();
    const out = new Map<string, MarketSnapshotDoc>();
    for (const r of docs) {
      if (r.doc) out.set(r.doc.symbol, r.doc as MarketSnapshotDoc);
    }
    return out;
  }

  async findPriceHistory(
    tradingDate: string,
    symbol: string,
    from: Date,
    to: Date,
  ): Promise<MarketSnapshotDoc[]> {
    return this.collection
      .find({
        tradingDate,
        symbol,
        timestamp: { $gte: from, $lte: to },
      })
      .sort({ timestamp: 1 })
      .toArray();
  }
}
