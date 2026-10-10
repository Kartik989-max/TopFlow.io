import { ObjectId } from 'mongodb';

export const INSTRUMENT_COLLECTION = 'instruments';

export interface InstrumentDoc {
  _id?: ObjectId;
  symbol: string;
  companyName: string;
  exchange: string;
  segment: string;
  instrumentToken: string;
  active: boolean;
  indexMembership: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type InstrumentInput = Omit<InstrumentDoc, '_id' | 'createdAt' | 'updatedAt'>;

export interface Instrument {
  id: string;
  symbol: string;
  companyName: string;
  exchange: string;
  segment: string;
  instrumentToken: string;
  active: boolean;
  indexMembership: string[];
}

export function toInstrument(doc: InstrumentDoc): Instrument {
  return {
    id: doc._id?.toString() ?? '',
    symbol: doc.symbol,
    companyName: doc.companyName,
    exchange: doc.exchange,
    segment: doc.segment,
    instrumentToken: doc.instrumentToken,
    active: doc.active,
    indexMembership: doc.indexMembership,
  };
}
