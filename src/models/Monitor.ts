import { ObjectId } from 'mongodb';

export const MONITOR_COLLECTION = 'monitors';

export type MonitorStatus = 'ACTIVE' | 'COMPLETED';

export interface MonitorDoc {
  _id?: ObjectId;
  signalId: ObjectId;
  tradingDate: string;
  symbol: string;

  signalTimestamp: Date;
  signalPrice: number;

  monitoringStartedAt: Date;
  monitoringEndedAt: Date | null;

  status: MonitorStatus;

  targetObservationTimes: string[]; // ["1M","5M","10M","15M","30M","EOD"]
  completedObservationTimes: string[];

  createdAt: Date;
  updatedAt: Date;
}

export interface Monitor {
  id: string;
  signalId: string;
  tradingDate: string;
  symbol: string;
  signalTimestamp: Date;
  signalPrice: number;
  monitoringStartedAt: Date;
  monitoringEndedAt: Date | null;
  status: MonitorStatus;
  targetObservationTimes: string[];
  completedObservationTimes: string[];
}
