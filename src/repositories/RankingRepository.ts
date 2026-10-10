import { type Filter } from 'mongodb';
import { BaseRepository } from './BaseRepository.js';
import { type RankingSnapshotDoc, RANKING_SNAPSHOT_COLLECTION } from '../models/RankingSnapshot.js';

export class RankingRepository extends BaseRepository<RankingSnapshotDoc> {
  protected collectionName = RANKING_SNAPSHOT_COLLECTION;

  // Idempotent by {tradingDate, timestamp}.
  async upsert(snapshot: Omit<RankingSnapshotDoc, '_id'>): Promise<void> {
    const filter: Filter<RankingSnapshotDoc> = {
      tradingDate: snapshot.tradingDate,
      timestamp: snapshot.timestamp,
    };
    await this.collection.updateOne(filter, { $set: snapshot }, { upsert: true });
  }

  async findLatest(tradingDate: string): Promise<RankingSnapshotDoc | null> {
    return this.collection.findOne({ tradingDate }, { sort: { timestamp: -1 } });
  }

  async findLatestPerSymbolRank(
    tradingDate: string,
    symbol: string,
  ): Promise<RankingSnapshotDoc | null> {
    return this.collection.findOne(
      { tradingDate, 'allRankedSymbols.symbol': symbol },
      { sort: { timestamp: -1 } },
    );
  }
}
