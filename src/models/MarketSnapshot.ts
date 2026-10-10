import { ObjectId } from 'mongodb';

export const MARKET_SNAPSHOT_COLLECTION = 'marketSnapshots';

export interface MarketSnapshotDoc {
  _id?: ObjectId;
  tradingDate: string; // YYYY-MM-DD
  timestamp: Date; // wall-clock instant of this quote (IST)
  symbol: string;
  companyName: string;

  ltp: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;

  dayChange: number;
  dayChangePercent: number;

  volume: number; // cumulative volume for the day (shares)
  averagePrice: number; // VWAP-like average trade price cum

  bestBid: number | null;
  bestAsk: number | null;

  source: string;

  isStale: boolean;

  createdAt: Date;
}

export interface MarketSnapshot {
  id: string;
  tradingDate: string;
  timestamp: Date;
  symbol: string;
  companyName: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  dayChange: number;
  dayChangePercent: number;
  volume: number;
  averagePrice: number;
  bestBid: number | null;
  bestAsk: number | null;
  source: string;
  isStale: boolean;
}
