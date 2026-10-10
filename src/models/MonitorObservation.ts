import { ObjectId } from 'mongodb';

export const MONITOR_OBSERVATION_COLLECTION = 'monitorObservations';

export type ObservationType = '1M' | '5M' | '10M' | '15M' | '30M' | 'EOD';

export interface MonitorObservationDoc {
  _id?: ObjectId;
  monitorId: ObjectId;
  signalId: ObjectId;

  tradingDate: string;
  symbol: string;

  observationType: ObservationType;
  observationTimestamp: Date; // target wall-clock time for this observation

  price: number;

  absoluteChange: number;
  percentChange: number;

  maxFavorableMove: number;
  maxAdverseMove: number;

  volume: number | null;

  source: 'live' | 'backfilled' | 'interpolated';

  createdAt: Date;
}
