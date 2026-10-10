import logger from '../utils/logger.js';
import type { MonitorService } from '../services/MonitorService.js';
import type { MarketSnapshotDoc } from '../models/MarketSnapshot.js';
import type { SignalDoc } from '../models/Signal.js';
import type { MonitorDoc } from '../models/Monitor.js';

export class MonitorScheduler {
  private running = false;
  private activeTradingDate: string | null = null;

  constructor(private readonly monitorService: MonitorService) {}

  isRunning(): boolean {
    return this.running;
  }

  async start(tradingDate: string): Promise<void> {
    this.activeTradingDate = tradingDate;
    this.running = true;
    logger.info({ event: 'MONITOR_SCHEDULE_START', tradingDate }, 'Monitor scheduler started');
  }

  async createMonitor(signal: SignalDoc): Promise<MonitorDoc | null> {
    return this.monitorService.createMonitor(signal);
  }

  stop(): void {
    this.running = false;
    logger.info('Monitor scheduler stopped');
  }

  async tick(cycleTimestamp: Date, _snapshotsBySymbol: Map<string, MarketSnapshotDoc>): Promise<number> {
    if (!this.running || !this.activeTradingDate) return 0;
    return this.monitorService.checkObservations(cycleTimestamp);
  }

  async finalize(tradingDate: string, closeTs: Date): Promise<void> {
    this.running = false;
    const res = await this.monitorService.finalizeAll(tradingDate, closeTs);
    logger.info({ event: 'MONITORS_FINALIZED', ...res }, 'All monitors finalized');
  }
}
