import { ObjectId } from 'mongodb';

export const STRATEGY_COLLECTION = 'strategyConfigurations';

export interface StrategyConfig {
  _id?: ObjectId;
  name: string;
  topN: number;
  snapshotIntervalSeconds: number;
  minRelativeVolume: number;
  requirePositive5mMomentum: boolean;
  requirePositive10mMomentum: boolean;
  requireAboveVWAP: boolean;
  observationMinutes: number[]; // [1,5,10,15,30]
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
