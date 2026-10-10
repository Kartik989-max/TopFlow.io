import { ObjectId } from 'mongodb';

export const SIGNAL_COLLECTION = 'signals';

export type SignalStatus = 'ACTIVE' | 'COMPLETED' | 'INVALIDATED';

export interface SignalConditions {
  enteredTopN: boolean;
  highRelativeVolume: boolean;
  positive5mMomentum: boolean;
  positive10mMomentum: boolean;
  positive15mMomentum: boolean;
  aboveVWAP: boolean;
}

export interface SignalDoc {
  _id?: ObjectId;
  tradingDate: string;
  timestamp: Date; // snapshot time when signal fired
  symbol: string;
  companyName: string;

  previousRank: number | null;
  currentRank: number;

  previousTopN: string[];
  currentTopN: string[];

  dayChangePercent: number;

  volume: number;
  relativeVolume: number | null;

  priceAtSignal: number;

  vwap: number | null;
  distanceFromVWAPPercent: number | null;

  momentum5m: number | null;
  momentum10m: number | null;
  momentum15m: number | null;

  triggerType: 'NEW_TOP_N' | 'NEW_TOP_N_HIGH_VOL' | string;

  conditions: SignalConditions;

  status: SignalStatus;

  createdAt: Date;
}
