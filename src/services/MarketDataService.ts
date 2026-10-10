import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import type { MarketDataProvider, LatestQuote, InstrumentInfo } from '../providers/MarketDataProvider.js';
import { nowIST } from '../utils/time.js';

// Simple in-memory min-time rate limiter (replaces external dependency).
class RateLimiter {
  private last = 0;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly minTime: number) {}
  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, this.last + this.minTime - now);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    }) as Promise<T>;
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export interface DataQualityReport {
  symbol: string;
  received: boolean;
  present: boolean;
  stale: boolean;
  ageSeconds: number;
}

export class MarketDataService {
  private provider: MarketDataProvider;
  private limiter: RateLimiter;
  private latestQuotes = new Map<string, LatestQuote>();
  private lastProviderPull: Date | null = null;
  private readonly providerUnsub: (() => void) | null;
  private readonly quoteListeners = new Set<(q: LatestQuote) => void>();

  constructor(provider: MarketDataProvider) {
    this.provider = provider;
    // Central rate limiter. For streaming providers the feed already rate-shapes;
    // this limiter governs on-demand REST pulls (e.g. public provider).
    this.limiter = new RateLimiter(100);
    this.providerUnsub = provider.onQuote((q: LatestQuote) => {
      this.latestQuotes.set(q.symbol, q);
      for (const l of this.quoteListeners) {
        try { l(q); } catch { /* ignore listener errors */ }
      }
    });
  }

  async initialize(instruments: InstrumentInfo[]): Promise<void> {
    await this.provider.subscribe(instruments);
    // Seed latest map from provider.
    await this.pullIfNeeded();
  }

  async refresh(): Promise<void> {
    await this.pullIfNeeded();
  }

  private async pullIfNeeded(): Promise<void> {
    try {
      const map = await this.limiter.schedule(() => this.provider.getLatestSnapshots());
      let updated = 0;
      for (const q of map.values()) {
        this.latestQuotes.set(q.symbol, q);
        updated++;
      }
      this.lastProviderPull = new Date();
      if (updated > 0 && this.lastProviderPull) {
        logger.debug({ updated }, 'MarketDataService pull');
      }
    } catch (err) {
      logger.error({ err, provider: this.provider.providerName }, 'Provider getLatestSnapshots failed');
    }
  }

  getQuote(symbol: string): LatestQuote | undefined {
    return this.latestQuotes.get(symbol);
  }

  getAllQuotes(): Map<string, LatestQuote> {
    return new Map(this.latestQuotes);
  }

  getSymbols(): string[] {
    return [...this.latestQuotes.keys()];
  }

  lastReceivedAt(symbol: string): number | null {
    const q = this.latestQuotes.get(symbol);
    if (!q) return null;
    return q.receivedAt;
  }

  isStale(symbol: string): boolean {
    const q = this.latestQuotes.get(symbol);
    if (!q) return true;
    const now = nowIST().toMillis();
    return now - q.receivedAt > env.MAX_DATA_AGE_SECONDS * 1000;
  }

  dataQualityReport(symbols: string[]): DataQualityReport[] {
    const now = nowIST().toMillis();
    return symbols.map((s) => {
      const q = this.latestQuotes.get(s);
      const received = !!q;
      const ageSeconds = received ? (now - q.receivedAt) / 1000 : 9999;
      return {
        symbol: s,
        received,
        present: received,
        stale: ageSeconds > env.MAX_DATA_AGE_SECONDS,
        ageSeconds,
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    return this.provider.healthCheck();
  }

  getProviderName(): string {
    return this.provider.providerName;
  }

  onQuote(listener: (q: LatestQuote) => void): () => void {
    this.quoteListeners.add(listener);
    return () => this.quoteListeners.delete(listener);
  }

  unsubscribeAll(): void {
    this.providerUnsub?.();
    this.quoteListeners.clear();
  }
}
