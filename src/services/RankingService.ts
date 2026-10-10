import type { MarketSnapshotDoc } from '../models/MarketSnapshot.js';
import type { RankedItem, RankingSnapshotDoc } from '../models/RankingSnapshot.js';
import { env } from '../config/env.js';

export interface TopNChange {
  currentTopN: string[];
  newEntrants: Array<{ symbol: string; rank: number; dayChangePercent: number; volume: number }>;
  exited: string[];
}

export class RankingService {
  private previousTopN: string[] = [];
  private initialized = false;
  private readonly topN: number;

  constructor(topN: number = env.TOP_N) {
    this.topN = topN;
  }

  getTopN(): number {
    return this.topN;
  }

  /** Sort all snapshots by intraday % change descending. */
  rank(snapshots: MarketSnapshotDoc[]): RankedItem[] {
    return snapshots
      .slice()
      .sort((a, b) => b.dayChangePercent - a.dayChangePercent)
      .map((s, i) => ({
        rank: i + 1,
        symbol: s.symbol,
        companyName: s.companyName,
        dayChangePercent: s.dayChangePercent,
        volume: s.volume,
        ltp: s.ltp,
      }));
  }

  /**
   * Detect new Top-N entrants.
   * Spec 19: only fires when a symbol was NOT in the previous Top N but IS now.
   * The first cycle is treated as initialization (no entrants emitted) so we
   * never signal from the initial incomplete ranking (spec 50).
   */
  detectTopNChanges(ranked: RankedItem[]): TopNChange {
    const currentTopN = ranked.slice(0, this.topN).map((r) => r.symbol);

    if (!this.initialized) {
      this.initialized = true;
      this.previousTopN = currentTopN;
      return { currentTopN, newEntrants: [], exited: [] };
    }

    const prevSet = new Set(this.previousTopN);
    const currSet = new Set(currentTopN);

    const newEntrants: TopNChange['newEntrants'] = [];
    for (let i = 0; i < Math.min(this.topN, ranked.length); i++) {
      const r = ranked[i];
      if (!prevSet.has(r.symbol)) {
        newEntrants.push({
          symbol: r.symbol,
          rank: r.rank,
          dayChangePercent: r.dayChangePercent,
          volume: r.volume,
        });
      }
    }

    const exited: string[] = [];
    for (const s of this.previousTopN) {
      if (!currSet.has(s)) exited.push(s);
    }

    this.previousTopN = currentTopN;
    return { currentTopN, newEntrants, exited };
  }

  reset(): void {
    this.previousTopN = [];
    this.initialized = false;
  }

  setPreviousTopN(symbols: string[]): void {
    this.previousTopN = symbols;
    this.initialized = true;
  }

  getPreviousTopN(): string[] {
    return [...this.previousTopN];
  }

  buildRankingSnapshot(
    ranked: RankedItem[],
    tradingDate: string,
    timestamp: Date,
    topN: number = this.topN,
  ): RankingSnapshotDoc {
    const top = Math.min(topN * 2, ranked.length); // store top 2*N per spec "Top 10 default"
    const topGainers = ranked.slice(0, top);
    const topLosers = [...ranked].reverse().slice(0, top);
    return {
      tradingDate,
      timestamp,
      topGainers,
      topLosers,
      allRankedSymbols: ranked, // store full for research per spec ("store ALL 50")
      rankedCount: ranked.length,
      metadata: { topN, snapshotIntervalSeconds: env.SNAPSHOT_INTERVAL_MS / 1000 },
      createdAt: new Date(),
    };
  }
}
