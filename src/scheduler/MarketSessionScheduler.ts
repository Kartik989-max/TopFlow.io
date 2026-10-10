import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { nextAlignedTimestamp } from '../utils/time.js';
import type { MarketDataService } from '../services/MarketDataService.js';
import { SnapshotScheduler } from './SnapshotScheduler.js';
import { MonitorScheduler } from './MonitorScheduler.js';
import { TradingSessionService } from '../services/TradingSessionService.js';
import { InstrumentRepository } from '../repositories/InstrumentRepository.js';
import { TradingSessionRepository } from '../repositories/TradingSessionRepository.js';
import { MarketSessionState } from '../state/MarketSessionState.js';
import { SignalEngine } from '../services/SignalEngine.js';

export class MarketSessionScheduler {
  private readonly dataService: MarketDataService;
  private readonly snapshotScheduler: SnapshotScheduler;
  private readonly sessionService: TradingSessionService;
  private readonly instruments: InstrumentRepository;
  private readonly sessions: TradingSessionRepository;
  public readonly state: MarketSessionState;

  private running = false;
  private sessionOpened = false;
  private cancelSleep: (() => void) | null = null;
  private readonly signalEngine?: SignalEngine;
  private readonly monitorScheduler?: MonitorScheduler;

  constructor(deps: {
    dataService: MarketDataService;
    snapshotScheduler: SnapshotScheduler;
    sessionService: TradingSessionService;
    instruments: InstrumentRepository;
    sessions: TradingSessionRepository;
    state: MarketSessionState;
    signalEngine?: SignalEngine;
    monitorScheduler?: MonitorScheduler;
  }) {
    this.dataService = deps.dataService;
    this.snapshotScheduler = deps.snapshotScheduler;
    this.sessionService = deps.sessionService;
    this.instruments = deps.instruments;
    this.sessions = deps.sessions;
    this.state = deps.state;
    this.signalEngine = deps.signalEngine;
    this.monitorScheduler = deps.monitorScheduler;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info({ provider: this.dataService.getProviderName() }, 'Market session scheduler started');
    void this.lifecycle();
  }

  stop(): void {
    this.running = false;
    this.cancelSleep?.();
    this.cancelSleep = null;
    this.snapshotScheduler.stop();
    logger.info('Market session scheduler stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private async lifecycle(): Promise<void> {
    while (this.running) {
      const window = this.sessionService.currentWindow();
      if (window.status === 'OPEN') {
        if (!this.sessionOpened) {
          await this.onMarketOpen(window.tradingDate!);
        }
        const result = await this.snapshotScheduler.runCycle();

        // Signal evaluation: only when data was complete (no missing instruments).
        if (this.signalEngine && !result.incomplete && result.newEntrants.length) {
          for (const entrant of result.newEntrants) {
            const snap = result.snapshotsBySymbol.get(entrant.symbol);
            if (!snap) continue;
            try {
              const signal = await this.signalEngine.evaluateNewEntry(
                {
                  symbol: entrant.symbol,
                  snapshot: snap,
                  newEntrant: entrant,
                  previousTopN: this.state.previousTopN,
                  currentTopN: result.currentTopN,
                },
                result.cycleTimestamp,
              );
              if (signal && this.monitorScheduler) {
                await this.monitorScheduler.createMonitor(signal);
              }
            } catch (err) {
              logger.error({ err, symbol: entrant.symbol }, 'Signal evaluation failed');
            }
          }
        }

        // Monitor observations per cycle.
        if (this.monitorScheduler) {
          await this.monitorScheduler.tick(result.cycleTimestamp, result.snapshotsBySymbol);
        }

        const nextBoundary = nextAlignedTimestamp(env.SNAPSHOT_INTERVAL_MS, Date.now());
        const closeMs = window.sessionEnd ? window.sessionEnd.getTime() : Date.now() + 60_000;
        const target = Math.min(nextBoundary, closeMs);
        const remaining = target - Date.now();
        if (remaining <= 0) {
          // at/past close boundary
          await this.onMarketClose(window.tradingDate!);
          continue;
        }
        await this.wait(remaining);
        if (Date.now() >= closeMs) {
          await this.onMarketClose(window.tradingDate!);
        }
        continue;
      }

      // status UPCOMING or CLOSED
      if (this.sessionOpened) {
        await this.onMarketClose(window.tradingDate!);
      }
      await this.wait(Math.max(1_000, window.untilTransitionMs));
    }
  }

  private async onMarketOpen(tradingDate: string): Promise<void> {
    this.sessionOpened = true;
    try {
      await this.sessionService.openSession(tradingDate);
      this.state.tradingDate = tradingDate;
      this.state.status = 'OPEN';

      // Load instruments + seed provider subscription.
      const instrumentRows = await this.instruments.findActiveByIndex(env.INDEX_NAME);
      if (instrumentRows.length === 0) {
        logger.warn({ tradingDate, count: 0 }, 'No active instruments found; seed the instruments collection');
      }
      await this.dataService.initialize(instrumentRows);

      // Restore ranking/in-session state for restart recovery.
      await this.restoreSessionState(tradingDate);
      this.snapshotScheduler.restoreRankingState(this.state.previousTopN);
      this.monitorScheduler?.start(tradingDate);

      logger.info({ event: 'SESSION_START', tradingDate, instrumentCount: instrumentRows.length });
    } catch (err) {
      logger.error({ err, tradingDate }, 'Failed to open market session');
      await this.sessionService.setError(tradingDate, String(err));
      this.sessionOpened = false;
    }
  }

  private async onMarketClose(tradingDate: string): Promise<void> {
    this.sessionOpened = false;
    const closeTs = new Date();
    try {
      await this.monitorScheduler?.finalize(tradingDate, closeTs);
      await this.sessionService.closeSession(tradingDate);
      await this.persistSessionState(tradingDate);
      logger.info({ event: 'SESSION_END', tradingDate });
    } catch (err) {
      logger.error({ err, tradingDate }, 'Failed to close market session');
    }
    this.monitorScheduler?.stop();
    // Reset in-memory state; wait for next open.
    this.state.status = 'CLOSED';
    this.state.previousTopN = [];
    this.state.currentTopN = [];
  }

  private async restoreSessionState(tradingDate: string): Promise<void> {
    const session = await this.sessions.findByDate(tradingDate);
    if (session?.state?.previousTopN) {
      this.state.previousTopN = session.state.previousTopN;
      this.state.currentTopN = session.state.currentTopN ?? [];
      if (session.state.lastSnapshotAt) this.state.lastSnapshotAt = session.state.lastSnapshotAt;
      logger.info({ restoredTopN: this.state.previousTopN.length }, 'Restored session state from DB');
    }
  }

  private async persistSessionState(tradingDate: string): Promise<void> {
    const snap = this.state.snapshot();
    await this.sessions.setSessionState(tradingDate, snap, this.state.snapshotCount);
  }

  private wait(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);
      this.cancelSleep = () => {
        clearTimeout(timeout);
        resolve(undefined);
      };
    });
  }
}
