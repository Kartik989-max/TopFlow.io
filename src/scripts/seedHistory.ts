import { connect, close, ensureIndexes } from '../repositories/mongo.js';
import { InstrumentRepository } from '../repositories/InstrumentRepository.js';
import { SnapshotRepository } from '../repositories/SnapshotRepository.js';
import { InstrumentService } from '../services/InstrumentService.js';
import { env } from '../config/env.js';
import { isTradingDay } from '../utils/time.js';
import type { LatestQuote } from '../providers/MarketDataProvider.js';
import logger from '../utils/logger.js';
import { DateTime } from 'luxon';
import { SeededRandom } from '../utils/prng.js';

// Seeds prior trading days with mock snapshots so the relative-volume engine
// (spec 20) has a baseline to compare against. Run once after a fresh deploy:
//   npm run seed:history
// It is idempotent: existing snapshots for a day are left untouched.

const HISTORY_DAYS = Number(process.env.SEED_HISTORY_DAYS ?? env.MOCK_HISTORY_DAYS ?? 5);
const SESSION_MINUTES = 360; // 09:15..15:30 inclusive-ish; capped per run.

interface SymbolParams {
  symbol: string;
  basePrice: number;
  drift: number;
}

function buildParams(instruments: { symbol: string }[]): SymbolParams[] {
  const base = new SeededRandom(1000 + 42);
  return instruments.map((inst) => {
    const price = 1_000 + Math.round(base.next() * 4_500);
    const drift = (base.next() - 0.5) * 0.04;
    return { symbol: inst.symbol, basePrice: price, drift };
  });
}

function quoteAt(
  p: SymbolParams,
  sessionMin: number,
  rng: SeededRandom,
): Omit<LatestQuote, 'timestamp' | 'receivedAt'> {
  const trendPct = p.drift * sessionMin;
  const noise = (rng.next() - 0.5) * 0.04;
  const ltp = Math.round((p.basePrice * (1 + trendPct / 100 + noise / 100)) * 100) / 100;
  const volume = Math.round((120 + rng.next() * 40) * (1 + Math.abs(trendPct) * 50));
  return {
    symbol: p.symbol,
    exchange: 'NSE',
    ltp,
    open: ltp,
    high: ltp,
    low: ltp,
    previousClose: p.basePrice,
    dayChange: ltp - p.basePrice,
    dayChangePercent: ((ltp - p.basePrice) / p.basePrice) * 100,
    volume,
    averagePrice: ltp,
    bestBid: Math.round(ltp * 0.999 * 100) / 100,
    bestAsk: Math.round(ltp * 1.001 * 100) / 100,
  };
}

async function seedDay(
  tradingDate: string,
  repo: SnapshotRepository,
  instruments: { symbol: string; companyName: string }[],
): Promise<number> {
  const existing = await repo.countForDate(tradingDate);
  if (existing > 0) {
    logger.info({ tradingDate, existing }, 'History day already seeded; skipping');
    return 0;
  }

  const params = buildParams(instruments);
  // Use a stable per-day seed so re-runs produce the same curve.
  const daySeed = tradingDate.split('-').reduce((h, part) => h ^ Number(part), 0);
  let count = 0;
  for (let m = 0; m <= SESSION_MINUTES; m += 5) {
    const ts = DateTime.fromISO(tradingDate, { zone: env.MARKET_TIMEZONE })
      .plus({ hours: 9, minutes: 15 })
      .plus({ minutes: m });
    const rng = new SeededRandom(daySeed + m);
    const docs = params.map((p) => {
      const q = quoteAt(p, m, rng);
      return {
        tradingDate,
        timestamp: ts.toJSDate(),
        symbol: p.symbol,
        companyName: instruments.find((i) => i.symbol === p.symbol)?.companyName ?? p.symbol,
        ltp: q.ltp,
        open: q.open,
        high: q.high,
        low: q.low,
        previousClose: p.basePrice,
        dayChange: q.dayChange,
        dayChangePercent: q.dayChangePercent,
        volume: q.volume,
        averagePrice: q.averagePrice,
        bestBid: q.bestBid,
        bestAsk: q.bestAsk,
        source: 'mock',
        isStale: false,
        createdAt: new Date(),
      };
    });
    await repo.upsertMany(docs);
    count += docs.length;
  }
  logger.info({ tradingDate, snapshots: count }, 'History day seeded');
  return count;
}

async function main(): Promise<void> {
  await connect();
  await ensureIndexes();
  const instrumentsRepo = new InstrumentRepository();
  const instrumentService = new InstrumentService(instrumentsRepo);
  await instrumentService.seedNifty50();
  const instruments = await instrumentsRepo.findActiveByIndex(env.INDEX_NAME);
  if (instruments.length === 0) {
    throw new Error('No active instruments; run the app once to seed NIFTY 50 first.');
  }
  const repo = new SnapshotRepository();

  const today = DateTime.now().setZone(env.MARKET_TIMEZONE).toISODate() ?? '';
  let total = 0;
  for (let i = 1; i <= HISTORY_DAYS; i++) {
    const d = DateTime.now().setZone(env.MARKET_TIMEZONE).minus({ days: i });
    // Skip weekends and NSE holidays.
    if (!isTradingDay(d)) continue;
    const date = d.toISODate() ?? '';
    if (date >= today) continue;
    total += await seedDay(date, repo, instruments);
  }
  logger.info({ totalSnapshots: total }, 'History seeding complete');
  await close();
}

void main().catch((err) => {
  logger.error({ err }, 'Seed history failed');
  process.exit(1);
});