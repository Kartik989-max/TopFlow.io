import { ObjectId } from 'mongodb';

export const TRADING_SESSION_COLLECTION = 'tradingSessions';

export type SessionStatus = 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'ERROR';

export interface TradingSessionDoc {
  _id?: ObjectId;
  tradingDate: string; // YYYY-MM-DD
  timezone: string;
  marketOpen: string; // "09:15"
  marketClose: string; // "15:30"
  status: SessionStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  snapshotCount: number;
  signalCount: number;
  state?: {
    previousTopN: string[];
    currentTopN: string[];
    lastSnapshotAt: Date | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TradingSession {
  id: string;
  tradingDate: string;
  timezone: string;
  marketOpen: string;
  marketClose: string;
  status: SessionStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  snapshotCount: number;
  signalCount: number;
}
