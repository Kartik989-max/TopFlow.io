import { type UpdateFilter } from 'mongodb';
import { BaseRepository } from './BaseRepository.js';
import {
  type TradingSessionDoc,
  type SessionStatus,
  TRADING_SESSION_COLLECTION,
} from '../models/TradingSession.js';

export class TradingSessionRepository extends BaseRepository<TradingSessionDoc> {
  protected collectionName = TRADING_SESSION_COLLECTION;

  async findOrCreate(tradingDate: string, overrides: Partial<TradingSessionDoc> = {}): Promise<TradingSessionDoc> {
    const now = new Date();
    const doc: TradingSessionDoc = {
      tradingDate,
      timezone: 'Asia/Kolkata',
      marketOpen: '09:15',
      marketClose: '15:30',
      status: 'SCHEDULED',
      startedAt: null,
      endedAt: null,
      snapshotCount: 0,
      signalCount: 0,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...insertDoc } = doc;
    await this.collection.updateOne(
      { tradingDate },
      { $setOnInsert: insertDoc, $set: { updatedAt: now } },
      { upsert: true },
    );
    const found = await this.collection.findOne({ tradingDate });
    if (!found) throw new Error(`Failed to find trading session ${tradingDate}`);
    return found;
  }

  async findByDate(tradingDate: string): Promise<TradingSessionDoc | null> {
    return this.collection.findOne({ tradingDate });
  }

  async findActive(): Promise<TradingSessionDoc | null> {
    return this.collection.findOne(
      { status: { $in: ['SCHEDULED', 'OPEN'] } },
      { sort: { tradingDate: -1 } },
    );
  }

  async updateStatus(tradingDate: string, status: SessionStatus, ts = new Date()): Promise<void> {
    const set: Partial<TradingSessionDoc> = { status, updatedAt: ts };
    if (status === 'OPEN') set.startedAt = ts;
    if (status === 'CLOSED') set.endedAt = ts;
    await this.collection.updateOne({ tradingDate }, { $set: set });
  }

  async setStartedAt(tradingDate: string, startedAt: Date): Promise<void> {
    await this.collection.updateOne(
      { tradingDate },
      { $set: { startedAt, updatedAt: startedAt } },
    );
  }

  async setEndedAt(tradingDate: string, endedAt: Date): Promise<void> {
    await this.collection.updateOne({ tradingDate }, { $set: { endedAt, updatedAt: endedAt } });
  }

  async incrementCounts(tradingDate: string, delta: { snapshots?: number; signals?: number }): Promise<void> {
    const $inc: Record<string, number> = {};
    if (delta.snapshots) $inc.snapshotCount = delta.snapshots;
    if (delta.signals) $inc.signalCount = delta.signals;
    if (Object.keys($inc).length === 0) return;
    await this.collection.updateOne({ tradingDate }, { $inc });
  }

  async setSessionState(
    tradingDate: string,
    state: TradingSessionDoc['state'],
    snapshotCount: number,
  ): Promise<void> {
    const update: UpdateFilter<TradingSessionDoc> = {
      $set: { state, updatedAt: new Date() },
      $inc: { snapshotCount },
    };
    await this.collection.updateOne({ tradingDate }, update);
  }
}
