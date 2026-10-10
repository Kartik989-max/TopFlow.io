import type {
  InstrumentInfo,
  LatestQuote,
  MarketDataProvider,
  QuoteListener,
} from './MarketDataProvider.js';
import { retry } from '../utils/retry.js';
import logger from '../utils/logger.js';

// Best-effort public provider. Dev only. Does NOT bypass rate limits or
// anti-bot controls. Treats all data as unverified.
const PUBLIC_ENDPOINT = process.env.PUBLIC_MARKET_URL || '';

export class PublicProvider implements MarketDataProvider {
  readonly supportsStreaming = false;
  readonly providerName = 'Public';

  private instruments: InstrumentInfo[] = [];
  private lastSnapshots = new Map<string, LatestQuote>();
  private listeners = new Set<QuoteListener>();

  async getInstruments(): Promise<InstrumentInfo[]> {
    // No public listing available; instruments must be seeded from config.
    return this.instruments;
  }

  async subscribe(instruments: InstrumentInfo[]): Promise<void> {
    this.instruments = instruments;
  }

  async unsubscribe(_instruments: InstrumentInfo[]): Promise<void> {
    this.instruments = [];
  }

  async getLatestSnapshots(): Promise<Map<string, LatestQuote>> {
    if (!PUBLIC_ENDPOINT) {
      throw new Error('PublicProvider has no endpoint configured (PUBLIC_MARKET_URL)');
    }
    const out = new Map<string, LatestQuote>();
    for (const inst of this.instruments) {
      try {
        const q = await retry(() => this.fetchOne(inst), { retries: 2 });
        if (q) {
          this.lastSnapshots.set(inst.symbol, q);
          out.set(inst.symbol, q);
          for (const l of this.listeners) l(q);
        }
      } catch (err) {
        logger.warn({ symbol: inst.symbol, err }, 'PublicProvider fetch failed for instrument');
      }
    }
    return out;
  }

  private async fetchOne(inst: InstrumentInfo): Promise<LatestQuote | null> {
    const res = await fetch(`${PUBLIC_ENDPOINT}/quote/${encodeURIComponent(inst.instrumentToken)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw: any = await res.json();
    if (!raw || typeof raw.ltp !== 'number' || raw.ltp <= 0) return null;
    const ltp = raw.ltp;
    const prev = Number(raw.previousClose ?? ltp);
    return {
      symbol: inst.symbol,
      exchange: inst.exchange,
      ltp,
      open: Number(raw.open ?? ltp),
      high: Number(raw.high ?? ltp),
      low: Number(raw.low ?? ltp),
      previousClose: prev,
      dayChange: ltp - prev,
      dayChangePercent: prev > 0 ? ((ltp - prev) / prev) * 100 : 0,
      volume: Math.round(Number(raw.volume ?? 0)),
      averagePrice: Number(raw.averagePrice ?? raw.vwap ?? ltp),
      bestBid: Number(raw.bestBid ?? ltp * 0.999),
      bestAsk: Number(raw.bestAsk ?? ltp * 1.001),
      timestamp: Date.now(),
      receivedAt: Date.now(),
    };
  }

  onQuote(listener: QuoteListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async healthCheck(): Promise<boolean> {
    if (!PUBLIC_ENDPOINT) return false;
    try {
      const res = await fetch(PUBLIC_ENDPOINT, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
