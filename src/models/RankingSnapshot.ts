import { ObjectId } from 'mongodb';

export const RANKING_SNAPSHOT_COLLECTION = 'rankingSnapshots';

export interface RankedItem {
  rank: number;
  symbol: string;
  companyName?: string;
  dayChangePercent: number;
  volume: number;
  ltp?: number;
}

export interface RankingSnapshotDoc {
  _id?: ObjectId;
  tradingDate: string;
  timestamp: Date;

  topGainers: RankedItem[];
  topLosers: RankedItem[];

  allRankedSymbols: RankedItem[];

  rankedCount: number;
  metadata?: Record<string, unknown>;

  createdAt: Date;
}

export interface RankingSnapshot {
  id: string;
  tradingDate: string;
  timestamp: Date;
  topGainers: RankedItem[];
  topLosers: RankedItem[];
  allRankedSymbols: RankedItem[];
  rankedCount: number;
}
