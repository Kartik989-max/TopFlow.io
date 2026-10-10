import logger from '../utils/logger.js';
import type { LatestQuote } from '../providers/MarketDataProvider.js';

export interface PricePoint {
  timestamp: number; // epoch ms
  ltp: number;
  volume: number; // cumulative day volume at this tick
}

export interface TopNState {
  inTopN: boolean;
  lastSignalAt: number | null;
}

export interface SessionStateSnapshot {
  tradingDate: string | null;
  status: string;
  previousTopN: string[];
  currentTopN: string[];
  lastSnapshotAt: Date | null;}

const HISTORY_LIMIT = 500; // keep enough for 5/10/15m momentum at 10s cadence

export class MarketSessionState {
  tradingDate: string | null = null;
  status: 'IDLE' | 'OPEN' | 'CLOSED' | 'UPCOMING' = 'IDLE';
  latestQuotes = new Map<string, LatestQuote>();
  previousTopN: string[] = [];
  currentTopN: string[] = [];
  topNStateBySymbol = new Map<string, TopNState>();
  // rolling recent price history per symbol for momentum/VWAP lookbacks
  priceHistory = new Map<string, PricePoint[]>();
  lastSnapshotAt: Date | null = null;
  snapshotCount = 0;

  init(tradingDate: string): void {
    this.tradingDate = tradingDate;
    this.status = 'OPEN';
    this.previousTopN = [];
    this.currentTopN = [];
    this.topNStateBySymbol.clear();
    this.priceHistory.clear();
    this.lastSnapshotAt = null;
    this.snapshotCount = 0;
    logger.info({ tradingDate }, 'Session state initialized');
  }

  restore(snapshot: SessionStateSnapshot): void {
    this.tradingDate = snapshot.tradingDate;
    this.status = snapshot.status as any;
    this.previousTopN = snapshot.previousTopN ?? [];
    this.currentTopN = snapshot.currentTopN ?? [];
    this.lastSnapshotAt = snapshot.lastSnapshotAt;
    // rebuild topNStateBySymbol from currentTopN
    this.topNStateBySymbol.clear();
    for (const s of this.currentTopN) this.topNStateBySymbol.set(s, { inTopN: true, lastSignalAt: null });
    logger.info({ tradingDate: snapshot.tradingDate, restoredTopN: this.currentTopN.length }, 'Session state restored');
  }

  recordPrice(symbol: string, ts: number, ltp: number, volume: number): void {
    let hist = this.priceHistory.get(symbol);
    if (!hist) {
      hist = [];
      this.priceHistory.set(symbol, hist);
    }
    hist.push({ timestamp: ts, ltp, volume });
    if (hist.length > HISTORY_LIMIT) hist.shift();
  }

  getLatest(symbol: string): PricePoint | undefined {
    const hist = this.priceHistory.get(symbol);
    if (!hist || hist.length === 0) return undefined;
    return hist[hist.length - 1];
  }

  priceAt(symbol: string, msAgo: number): number | undefined {
    const hist = this.priceHistory.get(symbol);
    if (!hist || hist.length === 0) return undefined;
    const target = hist[hist.length - 1].timestamp - msAgo;
    // nearest at-or-before
    let best: PricePoint | undefined;
    for (const p of hist) {
      if (p.timestamp <= target) best = p;
      else break;
    }
    return best?.ltp;
  }

  updateLatestQuotes(quotes: Map<string, LatestQuote>): void {
    for (const [sym, q] of quotes.entries()) this.latestQuotes.set(sym, q);
  }

  setTopN(current: string[], entrants: string[], exited: string[]): void {
    this.previousTopN = [...current];
    this.currentTopN = [...current];
    for (const s of entrants) {
      this.topNStateBySymbol.set(s, { inTopN: true, lastSignalAt: null });
    }
    for (const s of exited) {
      const prev = this.topNStateBySymbol.get(s);
      if (prev) prev.inTopN = false;
    }
  }

  snapshot(): SessionStateSnapshot {
    return {
      tradingDate: this.tradingDate,
      status: this.status,
      previousTopN: this.previousTopN,
      currentTopN: this.currentTopN,
      lastSnapshotAt: this.lastSnapshotAt,
    };
  }
}
