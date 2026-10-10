import type { LatestQuote } from '../providers/MarketDataProvider.js';
import type { InstrumentDoc } from '../models/Instrument.js';
import type { MarketSnapshotDoc } from '../models/MarketSnapshot.js';
import { env } from '../config/env.js';
import { nowIST } from '../utils/time.js';
import { round } from '../utils/math.js';
import logger from '../utils/logger.js';

export class SnapshotService {
  normalize(
    quote: LatestQuote,
    instrument: Pick<InstrumentDoc, 'symbol' | 'companyName'>,
    tradingDate: string,
  ): MarketSnapshotDoc {
    const receivedAt = quote.receivedAt;
    const ageSeconds = (nowIST().toMillis() - receivedAt) / 1000;
    const isStale = ageSeconds > env.MAX_DATA_AGE_SECONDS;

    const dayChange = round(quote.ltp - quote.previousClose, 4);
    const dayChangePercent =
      quote.previousClose > 0 ? round((dayChange / quote.previousClose) * 100, 4) : 0;

    const ts = new Date(quote.timestamp);
    return {
      tradingDate,
      timestamp: ts,
      symbol: quote.symbol,
      companyName: instrument.companyName,
      ltp: round(quote.ltp, 4),
      open: quote.open,
      high: quote.high,
      low: quote.low,
      previousClose: quote.previousClose,
      dayChange,
      dayChangePercent,
      volume: Math.round(quote.volume),
      averagePrice: round(quote.averagePrice, 4),
      bestBid: quote.bestBid,
      bestAsk: quote.bestAsk,
      source: 'mock',
      isStale,
      createdAt: new Date(),
    };
  }

  async persist(snapshots: MarketSnapshotDoc[]): Promise<void> {
    if (snapshots.length === 0) return;
    const SnapshotRepositoryModule = await import('../repositories/SnapshotRepository.js');
    const repo = new SnapshotRepositoryModule.SnapshotRepository();
    // Idempotent bulk upserts by natural key.
    const now = new Date();
    for (const s of snapshots) {
      s.createdAt = now;
    }
    await this.bulkUpsert(repo, snapshots);
    logger.debug({ count: snapshots.length }, 'Snapshots persisted');
  }

  private async bulkUpsert(
    repo: { upsert: (s: any) => Promise<void> },
    snapshots: MarketSnapshotDoc[],
  ): Promise<void> {
    // Sequential upsert is idempotent and simple for 50 docs / 10s cycle.
    for (const s of snapshots) {
      try {
        await repo.upsert(s);
      } catch (err) {
        logger.error({ symbol: s.symbol, err }, 'Failed to persist snapshot');
      }
    }
  }
}
