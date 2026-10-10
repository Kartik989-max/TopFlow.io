import { DateTime } from 'luxon';
import { SeededRandom } from '../utils/prng.js';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import type {
  InstrumentInfo,
  LatestQuote,
  MarketDataProvider,
  QuoteListener,
} from './MarketDataProvider.js';
import type { InstrumentDoc } from '../models/Instrument.js';

const STREAM_INTERVAL_MS = 2000; // how often the mock "feed" emits ticks

// Per-symbol deterministic parameters derived from a seed so behaviour is
// reproducible across runs (price at a given time-of-day is a pure function).
interface SymbolParams {
  symbol: string;
  companyName: string;
  exchange: string;
  instrumentToken: string;
  basePrice: number; // previousClose
  drift: number; // per-minute bias (percent of price), e.g. +0.02 = +2%/hr
  burstStartMin: number; // minute-of-session when momentum burst begins
  burstDurationMin: number;
  burstMagnitude: number; // extra percent drift during burst
}

export class MockProvider implements MarketDataProvider {
  readonly supportsStreaming = true;
  readonly providerName = 'Mock';

  private instruments: InstrumentInfo[] = [];
  private params: SymbolParams[] = [];
  private latestQuotes = new Map<string, LatestQuote>();
  private listeners = new Set<QuoteListener>();
  private streaming = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private sessionStart: DateTime | null = null;
  private readonly rng: SeededRandom;

  // Intraday state (recomputed/accumulated while session is open)
  private state = new Map<string, MockTickState>();

  constructor(seed = 42) {
    this.rng = new SeededRandom(seed);
  }

  async getInstruments(): Promise<InstrumentInfo[]> {
    if (this.instruments.length === 0) {
      throw new Error('MockProvider instruments not loaded. Call loadInstruments() first.');
    }
    return this.instruments;
  }

  loadInstruments(docs: InstrumentDoc[]): void {
    this.instruments = docs.map((d) => ({
      symbol: d.symbol,
      companyName: d.companyName,
      exchange: d.exchange,
      segment: d.segment,
      instrumentToken: d.instrumentToken,
    }));

    // Deterministic per-symbol parameters.
    const base = new SeededRandom(1000 + this.rng.nextInt(0, 1_000_000));
    this.params = this.instruments.map((inst) => {
      const price = 1_000 + Math.round(base.next() * 4_500); // 1000..5500 INR
      const drift = (base.next() - 0.5) * 0.08; // -0.04 .. +0.04 %/min
      const burstStart = 40 + Math.round(base.next() * 120); // 40-160 min into session
      const burstDur = 25 + Math.round(base.next() * 45);
      const burstMag = 0.6 + base.next() * 1.2; // 0.6%..1.8% extra per min during burst
      return {
        ...inst,
        basePrice: price,
        drift,
        burstStartMin: burstStart,
        burstDurationMin: burstDur,
        burstMagnitude: burstMag,
      } as SymbolParams;
    });

    // Make a few symbols "interesting" (accelerate into top 5) by boosting their
    // drift so the ranking/top-N demo actually fires in mock mode.
    const topPerformers = this.pickTopPerformers(3);
    for (const tp of topPerformers) {
      tp.drift = 0.1 + this.rng.next() * 0.25; // +0.10..0.35 %/min sustained
      tp.burstStartMin = 5;
      tp.burstDurationMin = 120;
      tp.burstMagnitude = 0;
    }
    // And a couple of laggards that trend down.
    const laggards = this.pickLaggards(2);
    for (const lg of laggards) {
      lg.drift = -0.1 - this.rng.next() * 0.15;
    }
  }

  private pickTopPerformers(n: number): SymbolParams[] {
    // Deterministic selection: highest-drift symbols become the demo winners.
    const sorted = [...this.params].sort((a, b) => b.drift - a.drift);
    return sorted.slice(0, n);
  }

  private pickLaggards(n: number): SymbolParams[] {
    const sorted = [...this.params].sort((a, b) => a.drift - b.drift);
    return sorted.slice(0, n);
  }

  async subscribe(_instruments: InstrumentInfo[]): Promise<void> {
    await this.startSession();
  }

  async unsubscribe(_instruments: InstrumentInfo[]): Promise<void> {
    this.stopStreaming();
  }

  onQuote(listener: QuoteListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getLatestSnapshots(): Promise<Map<string, LatestQuote>> {
    // Ensure we have at least one quote per instrument.
    if (this.latestQuotes.size < this.instruments.length) {
      await this.refreshAll();
    }
    return new Map(this.latestQuotes);
  }

  async healthCheck(): Promise<boolean> {
    return this.instruments.length === 50;
  }

  private async startSession(): Promise<void> {
    // Seed the previousClose/base from a representative day value if not set.
    this.sessionStart = null;
    await this.refreshAll();
    this.startStreaming();
  }

  private startStreaming(): void {
    if (this.streaming) return;
    this.streaming = true;
    const tick = () => {
      if (!this.streaming) return;
      this.refreshAll().catch((err) => logger.error({ err }, 'mock tick error'));
      if (this.streaming) this.interval = setInterval(tick, STREAM_INTERVAL_MS);
    };
    // initial tick
    tick();
  }

  private stopStreaming(): void {
    this.streaming = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async refreshAll(): Promise<void> {
    const now = DateTime.now().setZone(env.MARKET_TIMEZONE);
    if (!this.sessionStart) this.sessionStart = now;
    if (!this.instruments.length) return;

    for (const p of this.params) {
      const q = this.quoteFor(p, now);
      this.latestQuotes.set(p.symbol, q);
      for (const l of this.listeners) l(q);
    }
  }

  /** Deterministic point-in-time quote for a symbol. Pure function of time. */
  private quoteFor(p: SymbolParams, now: DateTime): LatestQuote {
    const ts = now.toMillis();
    const sessionSecs = Math.max(0, this.sessionSeconds(now));
    const sessionMin = sessionSecs / 60;

    const st = this.tickState(p.symbol, p.basePrice);

    // burst window contributes extra trend
    const inBurst =
      sessionMin >= p.burstStartMin && sessionMin <= p.burstStartMin + p.burstDurationMin;
    const extra = inBurst ? p.burstMagnitude : 0;
    const trendPct = (p.drift + extra) * sessionMin;

    // deterministic, reproducible noise (seeded by symbol + integer second)
    const noiseRng = new SeededRandom(this.hashSeed(p.symbol, sessionSecs));
    const noise = (noiseRng.next() - 0.5) * 0.04; // +-2% noise band component

    const prevClose = st.previousClose;
    const ltp = round2(prevClose * (1 + trendPct / 100 + noise / 100));

    // OHLC
    if (st.openPrice === null) st.openPrice = ltp;
    if (ltp > st.high) st.high = ltp;
    if (ltp < st.low) st.low = ltp;

    // Volume: deterministic per-second bucket so cumulative volume is monotonic
    // and reproducible. Larger when price is moving (vol ~ |drift|+noise).
    const secIndex = Math.floor(sessionSecs);
    const volRng = new SeededRandom(this.hashSeed(p.instrumentToken, secIndex));
    const baseVol = 120 + volRng.next() * 40; // shares per second baseline
    const moveFactor = Math.abs(trendPct / 100) + 0.05;
    const deltaVol = Math.max(0, Math.round(baseVol * (1 + moveFactor * 50)));
    st.volume += deltaVol;
    const priceLev = ltp;
    st.cumValue += priceLev * deltaVol;
    const avgPrice = st.volume > 0 ? st.cumValue / st.volume : ltp;

    const dayChange = ltp - prevClose;
    const dayChangePercent = prevClose > 0 ? (dayChange / prevClose) * 100 : 0;

    return {
      symbol: p.symbol,
      exchange: p.exchange,
      ltp,
      open: st.openPrice,
      high: st.high,
      low: st.low,
      previousClose: prevClose,
      dayChange,
      dayChangePercent,
      volume: st.volume,
      averagePrice: round2(avgPrice),
      bestBid: round2(ltp * 0.999),
      bestAsk: round2(ltp * 1.001),
      timestamp: ts,
      receivedAt: ts,
    };
  }

  private tickState(symbol: string, previousClose: number): MockTickState {
    let s = this.state.get(symbol);
    if (!s) {
      s = {
        previousClose,
        openPrice: null,
        high: previousClose,
        low: previousClose,
        volume: 0,
        cumValue: 0,
      };
      this.state.set(symbol, s);
    }
    return s;
  }

  private sessionSeconds(now: DateTime): number {
    // seconds elapsed since market open today (09:15)
    const open = DateTime.fromObject(
      {
        year: now.year,
        month: now.month,
        day: now.day,
        hour: Number(env.MARKET_OPEN.slice(0, 2)),
        minute: Number(env.MARKET_OPEN.slice(3, 5)),
      },
      { zone: env.MARKET_TIMEZONE },
    );
    const diff = now.toMillis() - open.toMillis();
    return Math.max(0, Math.floor(diff / 1000));
  }

  private hashSeed(symbol: string, sec: number): number {
    // simple deterministic int from string + int
    let h = 2166136261;
    for (let i = 0; i < symbol.length; i++) {
      h = (h ^ symbol.charCodeAt(i)) * 16777619;
    }
    h = (h + sec) >>> 0;
    return h;
  }
}

interface MockTickState {
  previousClose: number;
  openPrice: number | null;
  high: number;
  low: number;
  volume: number;
  cumValue: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
