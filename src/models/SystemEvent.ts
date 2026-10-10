import { ObjectId } from 'mongodb';

export const SYSTEM_EVENT_COLLECTION = 'systemEvents';

export type SystemEventType =
  | 'SESSION_START'
  | 'SESSION_END'
  | 'SNAPSHOT_CYCLE'
  | 'SIGNAL_CREATED'
  | 'MONITOR_STARTED'
  | 'OBSERVATION_RECORDED'
  | 'PROVIDER_DISCONNECT'
  | 'DB_ERROR'
  | 'DATA_STALE_WARNING';

export interface SystemEventDoc {
  _id?: ObjectId;
  eventType: SystemEventType;
  level: 'info' | 'warn' | 'error' | 'debug';
  tradingDate: string | null;
  correlationId: string | null;
  message: string;
  context: Record<string, unknown> | null;
  createdAt: Date;
}
