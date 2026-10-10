import { type Filter, ObjectId } from 'mongodb';
import { BaseRepository } from './BaseRepository.js';
import { type MonitorDoc, MONITOR_COLLECTION } from '../models/Monitor.js';

export class MonitorRepository extends BaseRepository<MonitorDoc> {
  protected collectionName = MONITOR_COLLECTION;

  async upsert(monitor: Omit<MonitorDoc, '_id'>): Promise<MonitorDoc> {
    const filter: Filter<MonitorDoc> = { signalId: monitor.signalId };
    const now = new Date();
    const { createdAt: _createdAt, ...updateFields } = monitor;
    await this.collection.updateOne(
      filter,
      { $set: updateFields, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    const stored = await this.collection.findOne(filter);
    if (!stored) throw new Error('Monitor not found after upsert');
    return stored;
  }

  async findActiveByDate(tradingDate: string): Promise<MonitorDoc[]> {
    return this.collection
      .find({ tradingDate, status: 'ACTIVE' })
      .sort({ signalTimestamp: 1 })
      .toArray();
  }

  async findById(id: string): Promise<MonitorDoc | null> {
    return this.collection.findOne({ _id: new ObjectId(id) });
  }

  async markCompleted(id: string, endedAt: Date): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'COMPLETED', monitoringEndedAt: endedAt, updatedAt: endedAt } },
    );
  }

  async markObservationDone(monitorId: string, observationType: string): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(monitorId) },
      {
        $addToSet: { completedObservationTimes: observationType },
        $set: { updatedAt: new Date() },
      },
    );
  }
}
