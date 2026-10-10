import { BaseRepository } from './BaseRepository.js';
import { type SystemEventDoc, SYSTEM_EVENT_COLLECTION } from '../models/SystemEvent.js';

export class SystemEventRepository extends BaseRepository<SystemEventDoc> {
  protected collectionName = SYSTEM_EVENT_COLLECTION;

  async log(event: Omit<SystemEventDoc, '_id'>): Promise<void> {
    await this.collection.insertOne({ ...event, createdAt: new Date() } as SystemEventDoc);
  }
}
