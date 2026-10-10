import type { MarketSessionState } from '../state/MarketSessionState.js';
import { round } from '../utils/math.js';

// Approximate intraday VWAP from periodic snapshots (spec 22). This is NOT
// tick-level VWAP; documented as approximate in README.
export class VWAPService {
  constructor(private readonly state: MarketSessionState) {}

  // Running VWAP across the day for a symbol using accumulated price*volume.
  vwap(symbol: string): number | null {
    const hist = this.state.priceHistory.get(symbol);
    if (!hist || hist.length === 0) return null;

    // Reconstruct incremental volume between snapshots to weight prices.
    let valueSum = 0;
    let volumeSum = 0;
    let prevVol = 0;
    for (const p of hist) {
      const deltaVol = Math.max(0, p.volume - prevVol);
      valueSum += p.ltp * deltaVol;
      volumeSum += deltaVol;
      prevVol = p.volume;
    }
    if (volumeSum === 0) return round(hist[hist.length - 1].ltp, 4);
    return round(valueSum / volumeSum, 4);
  }

  distanceFromVWAPPercent(symbol: string): number | null {
    const vwap = this.vwap(symbol);
    if (vwap === null) return null;
    const hist = this.state.priceHistory.get(symbol);
    const latest = hist && hist.length ? hist[hist.length - 1] : undefined;
    if (!latest || vwap === 0) return null;
    return round(((latest.ltp / vwap - 1) * 100), 4);
  }
}
