import { type Filter, ObjectId } from 'mongodb';
import { BaseRepository } from './BaseRepository.js';
import {
  type MonitorObservationDoc,
  MONITOR_OBSERVATION_COLLECTION,
} from '../models/MonitorObservation.js';

export class ObservationRepository extends BaseRepository<MonitorObservationDoc> {
  protected collectionName = MONITOR_OBSERVATION_COLLECTION;

  // Idempotent by {monitorId, observationType}.
  async upsert(obs: Omit<MonitorObservationDoc, '_id'>): Promise<void> {
    const filter: Filter<MonitorObservationDoc> = {
      monitorId: obs.monitorId,
      observationType: obs.observationType,
    };
    await this.collection.updateOne(filter, { $set: obs }, { upsert: true });
  }

  async findByMonitor(monitorId: string): Promise<MonitorObservationDoc[]> {
    return this.collection
      .find({ monitorId: new ObjectId(monitorId) })
      .sort({ observationTimestamp: 1 })
      .toArray();
  }

  async findBySymbolToday(tradingDate: string, symbol: string): Promise<MonitorObservationDoc[]> {
    return this.collection
      .find({ tradingDate, symbol })
      .sort({ observationTimestamp: 1 })
      .toArray();
  }
}
