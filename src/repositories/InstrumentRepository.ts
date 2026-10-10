import { type Collection, type Filter } from 'mongodb';
import { BaseRepository } from './BaseRepository.js';
import {
  type InstrumentDoc,
  type InstrumentInput,
  INSTRUMENT_COLLECTION,
} from '../models/Instrument.js';

export class InstrumentRepository extends BaseRepository<InstrumentDoc> {
  protected collectionName = INSTRUMENT_COLLECTION;

  async upsert(instrument: InstrumentInput): Promise<InstrumentDoc> {
    const now = new Date();
    const doc: InstrumentDoc = {
      ...instrument,
      exchange: instrument.exchange ?? 'NSE',
      segment: instrument.segment ?? 'CASH',
      indexMembership: instrument.indexMembership ?? [],
      active: instrument.active ?? true,
      createdAt: now,
      updatedAt: now,
    } as InstrumentDoc;
    const { createdAt: _createdAt, ...updateFields } = doc;
    await this.collection.updateOne(
      { symbol: doc.symbol, exchange: doc.exchange },
      { $set: updateFields, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    return doc;
  }

  async upsertMany(instruments: InstrumentInput[]): Promise<number> {
    let count = 0;
    for (const inst of instruments) {
      await this.upsert(inst);
      count++;
    }
    return count;
  }

  async findActiveByIndex(index: string): Promise<InstrumentDoc[]> {
    const filter: Filter<InstrumentDoc> = { active: true, indexMembership: index };
    return this.collection.find(filter).sort({ symbol: 1 }).toArray();
  }

  async findBySymbol(symbol: string): Promise<InstrumentDoc | null> {
    return this.collection.findOne({ symbol });
  }

  async updateIndexMembership(symbol: string, indexMembership: string[]): Promise<void> {
    await this.collection.updateOne(
      { symbol },
      { $set: { indexMembership, updatedAt: new Date() } },
    );
  }

  async deactivate(symbol: string): Promise<void> {
    await this.collection.updateOne({ symbol }, { $set: { active: false, updatedAt: new Date() } });
  }

  async countActive(): Promise<number> {
    return this.count({ active: true });
  }

  get collectionRef(): Collection<InstrumentDoc> {
    return this.collection;
  }
}
