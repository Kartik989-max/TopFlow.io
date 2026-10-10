import type {
  InstrumentInfo,
  LatestQuote,
  MarketDataProvider,
  QuoteListener,
} from './MarketDataProvider.js';
import { env } from '../config/env.js';

// Maps our normalized LatestQuote shape from a Groww quote payload.
function normalizeGrowwQuote(symbol: string, raw: any): LatestQuote | null {
  if (!raw || typeof raw !== 'object') return null;
  const ltp = Number(raw.ltp ?? raw.lastPrice ?? raw.close);
  if (!Number.isFinite(ltp) || ltp <= 0) return null;
  const prevClose = Number(raw.previousClose ?? raw.close ?? raw.previous_close);
  const open = Number(raw.open ?? raw.openPrice ?? prevClose);
  const high = Number(raw.high ?? raw.highPrice ?? ltp);
  const low = Number(raw.low ?? raw.lowPrice ?? ltp);
  const volume = Number(raw.volume ?? 0);
  const ts = raw.timestamp ? Date.parse(raw.timestamp as string) : Date.now();
  const now = Date.now();
  return {
    symbol,
    exchange: (raw.exchange ?? 'NSE') as string,
    ltp,
    open: Number.isFinite(open) ? open : ltp,
    high: Number.isFinite(high) ? high : ltp,
    low: Number.isFinite(low) ? low : ltp,
    previousClose: Number.isFinite(prevClose) ? prevClose : ltp,
    dayChange: Number.isFinite(ltp - prevClose) ? ltp - prevClose : 0,
    dayChangePercent: Number.isFinite(prevClose) && prevClose > 0 ? ((ltp - prevClose) / prevClose) * 100 : 0,
    volume: Math.round(volume),
    averagePrice: Number(raw.averagePrice ?? raw.vwap ?? ltp),
    bestBid: Number(raw.bestBid ?? raw.bid ?? ltp * 0.999),
    bestAsk: Number(raw.bestAsk ?? raw.ask ?? ltp * 1.001),
    timestamp: ts,
    receivedAt: now,
  };
}

export class GrowwProvider implements MarketDataProvider {
  readonly supportsStreaming = false;
  readonly providerName = 'Groww';

  private instruments: InstrumentInfo[] = [];
  private lastSnapshots = new Map<string, LatestQuote>();
  private listeners = new Set<QuoteListener>();

  async getInstruments(): Promise<InstrumentInfo[]> {
    throw new Error(
      'GrowwProvider.getInstruments is not implemented: configure NIFTY 50 constituents in the instruments collection.',
    );
  }

  async subscribe(instruments: InstrumentInfo[]): Promise<void> {
    this.instruments = instruments;
  }

  async unsubscribe(_instruments: InstrumentInfo[]): Promise<void> {
    this.instruments = [];
  }

  async getLatestSnapshots(): Promise<Map<string, LatestQuote>> {
    if (!env.GROWW_ACCESS_TOKEN && !env.GROWW_API_KEY) {
      throw new Error('Groww credentials missing (GROWW_ACCESS_TOKEN or GROWW_API_KEY)');
    }
    const baseUrl = process.env.GROWW_BASE_URL || 'https://api.groww.in/v1';
    const symbols = this.instruments.map((i) => i.instrumentToken);
    const url = `${baseUrl}/stocks/quotes?symbols=${encodeURIComponent(symbols.join(','))}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.GROWW_ACCESS_TOKEN ?? env.GROWW_API_KEY}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Groww API error ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json: any = await res.json().catch(() => null);
    if (!json || typeof json !== 'object') {
      throw new Error('Groww: malformed response');
    }
    const payload: Record<string, any> = json.quotes ?? json;
    const out = new Map<string, LatestQuote>();
    for (const inst of this.instruments) {
      const q = normalizeGrowwQuote(inst.symbol, payload[inst.instrumentToken] ?? payload[inst.symbol]?._ ?? payload[inst.symbol]);
      if (q) {
        this.lastSnapshots.set(inst.symbol, q);
        out.set(inst.symbol, q);
        for (const l of this.listeners) l(q);
      }
    }
    return out;
  }

  onQuote(listener: QuoteListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async healthCheck(): Promise<boolean> {
    if (!env.GROWW_ACCESS_TOKEN && !env.GROWW_API_KEY) return false;
    try {
      const base = process.env.GROWW_BASE_URL || 'https://api.groww.in/v1';
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
