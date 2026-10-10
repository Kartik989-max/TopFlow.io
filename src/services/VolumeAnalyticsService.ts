import type { SnapshotRepository } from '../repositories/SnapshotRepository.js';
import type { MarketSnapshotDoc } from '../models/MarketSnapshot.js';
import { round } from '../utils/math.js';
import logger from '../utils/logger.js';
import { DateTime } from 'luxon';
import { isTradingDay } from '../utils/time.js';

interface MinuteVolumePoint {
  minuteOfDay: number; // e.g. 11*60+00 = 660
  cumulativeVolume: number;
  timestamp: Date;
}

// Relative volume = current cumulative volume at this minute-of-day vs the
// historical average cumulative volume at the same minute across prior days
// (spec 20). Returns null when insufficient history exists.
export class VolumeAnalyticsService {
  private historyWindowDays = 20;

  constructor(private readonly snapshots: SnapshotRepository) {}

  async calculateRelativeVolume(
    symbol: string,
    tradingDate: string,
    minuteOfDay: number,
    currentCumulativeVolume: number,
  ): Promise<number | null> {
    const historicalPoints = await this.getHistoricalVolumeCurve(symbol, tradingDate, minuteOfDay);
    if (historicalPoints.length === 0) {
      logger.debug({ symbol, minuteOfDay }, 'No historical volume data; relativeVolume=null');
      return null;
    }
    const avg = this.averageCumulativeAtMinute(historicalPoints, minuteOfDay);
    if (!avg || avg <= 0) return null;
    return round(currentCumulativeVolume / avg, 4);
  }

  async getVolumeProfile(symbol: string, tradingDate: string): Promise<MinuteVolumePoint[]> {
    return this.snapshots.collectionRef
      .find({ tradingDate, symbol })
      .sort({ timestamp: 1 })
      .project({ timestamp: 1, volume: 1 })
      .toArray()
      .then((rows: Partial<MarketSnapshotDoc>[]) =>
        rows.map((r) => ({
          minuteOfDay: minuteOfDayOf(r.timestamp as Date),
          cumulativeVolume: r.volume as number,
          timestamp: r.timestamp as Date,
        })),
      );
  }

  private async getHistoricalVolumeCurve(
    symbol: string,
    tradingDate: string,
    minuteOfDay: number,
  ): Promise<MinuteVolumePoint[]> {
    // Look back across previous trading days and gather cumulative volume at the
    // same minute-of-day for each day.
    const dates = await this.previousTradingDates(tradingDate, this.historyWindowDays);
    const out: MinuteVolumePoint[] = [];
    for (const d of dates) {
      const pts = await this.getVolumeProfile(symbol, d);
      const at = this.nearestAtOrBefore(pts, minuteOfDay);
      if (at) out.push(at);
    }
    return out;
  }

  private averageCumulativeAtMinute(points: MinuteVolumePoint[], _minuteOfDay: number): number | null {
    const vals = points.map((p) => p.cumulativeVolume);
    if (vals.length === 0) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return sum / vals.length;
  }

  private nearestAtOrBefore(points: MinuteVolumePoint[], minute: number): MinuteVolumePoint | undefined {
    let best: MinuteVolumePoint | undefined;
    for (const p of points) {
      if (p.minuteOfDay <= minute) best = p;
      else break;
    }
    return best;
  }

  private async previousTradingDates(tradingDate: string, n: number): Promise<string[]> {
    // Walk backwards day-by-day, skipping weekends.
    const out: string[] = [];
    const start = DateTime.fromISO(tradingDate, { zone: 'Asia/Kolkata' }).minus({ days: 1 });
    let cur = start;
    while (out.length < n) {
      if (isTradingDay(cur)) out.push(cur.toISODate() ?? '');
      cur = cur.minus({ days: 1 });
      if (cur < start.minus({ days: 365 })) break;
    }
    return out;
  }
}

function minuteOfDayOf(date: Date): number {
  const d = DateTime.fromJSDate(date, { zone: 'Asia/Kolkata' });
  return d.hour * 60 + d.minute;
}
