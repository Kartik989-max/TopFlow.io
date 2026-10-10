import type { MarketSessionState, PricePoint } from '../state/MarketSessionState.js';
import { round } from '../utils/math.js';

// All calculations use the in-memory ring buffer (MarketSessionState.priceHistory).
// MongoDB is storage only; never queried for per-tick momentum (spec 21).
export class MomentumService {
  constructor(private readonly state: MarketSessionState) {}

  // percent return over the last `minutes` minutes: (price / priceNMinutesAgo - 1) * 100
  momentumPercent(symbol: string, minutes: number): number | null {
    const hist = this.state.priceHistory.get(symbol);
    if (!hist || hist.length < 2) return null;
    const latest = hist[hist.length - 1];
    const targetMs = minutes * 60_000;
    const pastPrice = this.priceAtOrBefore(symbol, latest.timestamp - targetMs);
    if (pastPrice === undefined || pastPrice === 0) return null;
    return round((latest.ltp / pastPrice - 1) * 100, 4);
  }

  private priceAtOrBefore(symbol: string, ts: number): number | undefined {
    const hist = this.state.priceHistory.get(symbol);
    if (!hist) return undefined;
    let best: PricePoint | undefined;
    for (const p of hist) {
      if (p.timestamp <= ts) best = p;
      else break;
    }
    return best?.ltp;
  }

  get5m(symbol: string): number | null {
    return this.momentumPercent(symbol, 5);
  }
  get10m(symbol: string): number | null {
    return this.momentumPercent(symbol, 10);
  }
  get15m(symbol: string): number | null {
    return this.momentumPercent(symbol, 15);
  }
}
