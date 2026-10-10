import { type Filter, ObjectId } from 'mongodb';
import { BaseRepository } from './BaseRepository.js';
import { type SignalDoc, type SignalStatus, SIGNAL_COLLECTION } from '../models/Signal.js';

export class SignalRepository extends BaseRepository<SignalDoc> {
  protected collectionName = SIGNAL_COLLECTION;

  // Idempotent by {tradingDate, symbol, timestamp, triggerType}.
  async upsert(signal: Omit<SignalDoc, '_id'>): Promise<SignalDoc> {
    const filter: Filter<SignalDoc> = {
      tradingDate: signal.tradingDate,
      symbol: signal.symbol,
      timestamp: signal.timestamp,
      triggerType: signal.triggerType,
    };
    const now = new Date();
    const { createdAt: _createdAt, ...updateFields } = signal;
    await this.collection.updateOne(
      filter,
      { $set: updateFields, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    const stored = await this.collection.findOne(filter);
    if (!stored) throw new Error('Signal not found after upsert');
    return stored;
  }

  async findToday(tradingDate: string): Promise<SignalDoc[]> {
    return this.collection.find({ tradingDate }).sort({ timestamp: 1 }).toArray();
  }

  async findById(id: string): Promise<SignalDoc | null> {
    return this.collection.findOne({ _id: new ObjectId(id) });
  }

  async updateStatus(id: string, status: SignalStatus): Promise<void> {
    await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: { status } });
  }

  async findBySymbolToday(tradingDate: string, symbol: string): Promise<SignalDoc[]> {
    return this.collection.find({ tradingDate, symbol }).sort({ timestamp: 1 }).toArray();
  }
}
