import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { nowIST, nextAlignedTimestamp } from '../utils/time.js';
import { sleep } from '../utils/retry.js';
import type { MarketDataService } from '../services/MarketDataService.js';
import { SnapshotService } from '../services/SnapshotService.js';
import { RankingService } from '../services/RankingService.js';
import { InstrumentRepository } from '../repositories/InstrumentRepository.js';
import { TradingSessionRepository } from '../repositories/TradingSessionRepository.js';
import { RankingRepository } from '../repositories/RankingRepository.js';
import { MarketSessionState } from '../state/MarketSessionState.js';
import type { MarketSnapshotDoc } from '../models/MarketSnapshot.js';

export interface CycleResult {
  cycleTimestamp: Date;
  receivedCount: number;
  instrumentCount: number;
  snapshots: number;
  snapshotsBySymbol: Map<string, MarketSnapshotDoc>;
  newEntrants: Array<{ symbol: string; rank: number; dayChangePercent: number; volume: number }>;
  currentTopN: string[];
  exited: string[];
  missing: string[];
  stale: string[];
  incomplete: boolean;
}

export class SnapshotScheduler {
  private readonly dataService: MarketDataService;
  private readonly snapshotService: SnapshotService;
  private readonly rankingService: RankingService;
  private readonly instruments: InstrumentRepository;
  private readonly sessions: TradingSessionRepository;
  private readonly rankings: RankingRepository;
  private readonly state: MarketSessionState;

  private running = false;
  private cycleInProgress = false;

  constructor(deps: {
    dataService: MarketDataService;
    snapshotService: SnapshotService;
    rankingService: RankingService;
    instruments: InstrumentRepository;
    sessions: TradingSessionRepository;
    rankings: RankingRepository;
    state: MarketSessionState;
  }) {
    this.dataService = deps.dataService;
    this.snapshotService = deps.snapshotService;
    this.rankingService = deps.rankingService;
    this.instruments = deps.instruments;
    this.sessions = deps.sessions;
    this.rankings = deps.rankings;
    this.state = deps.state;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info({ intervalMs: env.SNAPSHOT_INTERVAL_MS }, 'Snapshot scheduler started');
    void this.loop();
  }

  stop(): void {
    this.running = false;
    logger.info('Snapshot scheduler stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.runCycle();
      } catch (err) {
        logger.error({ err }, 'Snapshot cycle failed');
      }
      if (!this.running) break;
      const now = Date.now();
      const next = nextAlignedTimestamp(env.SNAPSHOT_INTERVAL_MS, now);
      const wait = Math.max(0, next - Date.now());
      // buffer a little to not cut the next cycle short
      await sleep(wait - 50 > 0 ? wait - 50 : 0);
    }
  }

  async runCycle(): Promise<CycleResult> {
    if (this.cycleInProgress) {
      logger.warn('Skipping snapshot cycle, previous still running');
      return this.emptyResult();
    }
    this.cycleInProgress = true;
    try {
      const tradingDate = this.state.tradingDate!;
      const now = nowIST();
      // align cycle timestamp to the configured grid
      const cycleTs = new Date(Math.floor(now.toMillis() / env.SNAPSHOT_INTERVAL_MS) * env.SNAPSHOT_INTERVAL_MS);
      const labelTs = cycleTs;

      const instrumentList = await this.instruments.findActiveByIndex(env.INDEX_NAME);
      const quotes = this.dataService.getAllQuotes();

      const snapshots: MarketSnapshotDoc[] = [];
      const snapshotsBySymbol = new Map<string, MarketSnapshotDoc>();
      const missing: string[] = [];
      const stale: string[] = [];

      for (const inst of instrumentList) {
        const q = quotes.get(inst.symbol);
        if (!q) {
          missing.push(inst.symbol);
          continue;
        }
        if (this.dataService.isStale(inst.symbol)) {
          stale.push(inst.symbol);
        }
        const snap = this.snapshotService.normalize(q, inst, tradingDate);
        snapshots.push(snap);
        snapshotsBySymbol.set(inst.symbol, snap);
        this.state.recordPrice(inst.symbol, q.timestamp, q.ltp, q.volume);
      }

      if (instrumentList.length > 0) {
        this.dataService.refresh().catch((err) => logger.error({ err }, 'refresh tick failed'));
      }

      await this.snapshotService.persist(snapshots);

      const ranked = this.rankingService.rank(snapshots);
      const rankingSnap = this.rankingService.buildRankingSnapshot(ranked, tradingDate, labelTs);
      await this.rankings.upsert(rankingSnap);

      const changes = this.rankingService.detectTopNChanges(ranked);
      this.state.setTopN(
        changes.currentTopN,
        changes.newEntrants.map((n) => n.symbol),
        changes.exited,
      );
      this.state.lastSnapshotAt = labelTs;
      this.state.snapshotCount += 1;

      for (const e of changes.newEntrants) {
        logger.info(
          { event: 'NEW_TOP_N_ENTRY', symbol: e.symbol, currentRank: e.rank, dayChangePercent: e.dayChangePercent },
          'New Top-N entrant',
        );
      }
      if (changes.exited.length) {
        logger.info({ event: 'TOP_N_EXITED', symbols: changes.exited }, 'Top-N exited');
      }

      const incomplete = missing.length > 0;
      if (incomplete) {
        logger.warn(
          { event: 'MARKET_SNAPSHOT', tradingDate, timestamp: labelTs.toISOString(), missing, stale, received: snapshots.length, total: instrumentList.length },
          'Snapshot cycle incomplete',
        );
      } else {
        logger.info(
          { event: 'MARKET_SNAPSHOT', tradingDate, timestamp: labelTs.toISOString(), receivedCount: snapshots.length, instrumentCount: instrumentList.length },
          'Snapshot cycle complete',
        );
      }

      await this.sessions.incrementCounts(tradingDate, { snapshots: 1 });

      return {
        cycleTimestamp: labelTs,
        receivedCount: snapshots.length,
        instrumentCount: instrumentList.length,
        snapshots: snapshots.length,
        snapshotsBySymbol,
        newEntrants: changes.newEntrants,
        currentTopN: changes.currentTopN,
        exited: changes.exited,
        missing,
        stale,
        incomplete,
      };
    } finally {
      this.cycleInProgress = false;
    }
  }

  restoreRankingState(previousTopN: string[]): void {
    this.rankingService.setPreviousTopN(previousTopN);
  }

  private emptyResult(): CycleResult {
    return {
      cycleTimestamp: new Date(),
      receivedCount: 0,
      instrumentCount: 0,
      snapshots: 0,
      snapshotsBySymbol: new Map(),
      newEntrants: [],
      currentTopN: [],
      exited: [],
      missing: [],
      stale: [],
      incomplete: false,
    };
  }
}
