import type { ObservationRepository } from '../repositories/ObservationRepository.js';
import type { SignalRepository } from '../repositories/SignalRepository.js';
import type { MonitorRepository } from '../repositories/MonitorRepository.js';
import type { SnapshotRepository } from '../repositories/SnapshotRepository.js';
import type { MonitorObservationDoc } from '../models/MonitorObservation.js';
import { mean, median, sum } from '../utils/math.js';

export interface StrategyAnalytics {
  totalSignals: number;
  uniqueStocks: number;
  averageReturn: Record<string, number | null>; // '1m','5m','10m','15m','30m','EOD'
  medianReturn: Record<string, number | null>;
  winRate: Record<string, number | null>;
  maxFavorableExcursion: number | null;
  maxAdverseExcursion: number | null;
  avgRelativeVolume: number | null;
  byRankBucket: Record<string, { count: number; avgReturn5m: number | null }>;
  byTimeOfDay: Record<string, { count: number; avgReturn5m: number | null }>;
}

const OBS_TYPES = ['1M', '5M', '10M', '15M', '30M', 'EOD'];

export class AnalyticsService {
  constructor(private readonly deps: {
    observations: ObservationRepository;
    signals: SignalRepository;
    monitors: MonitorRepository;
    snapshots: SnapshotRepository;
  }) {}

  async today(tradingDate: string): Promise<StrategyAnalytics> {
    const signals = await this.deps.signals.findToday(tradingDate);
    const obs = await this.aggregateObservations(tradingDate);

    const returnBuckets: Record<string, number[]> = { '1M': [], '5M': [], '10M': [], '15M': [], '30M': [], EOD: [] };
    for (const o of obs) {
      const key = o.observationType as keyof typeof returnBuckets;
      if (key in returnBuckets) returnBuckets[key].push(o.percentChange);
    }

    const averageReturn: Record<string, number | null> = {};
    const medianReturn: Record<string, number | null> = {};
    const winRate: Record<string, number | null> = {};
    for (const k of OBS_TYPES) {
      const arr = returnBuckets[k as keyof typeof returnBuckets];
      averageReturn[k] = arr.length ? Number(mean(arr).toFixed(4)) : null;
      medianReturn[k] = arr.length ? Number(median(arr).toFixed(4)) : null;
      winRate[k] = arr.length ? Number((arr.filter((v) => v > 0).length / arr.length).toFixed(4)) : null;
    }

    const relVols = signals.map((s) => s.relativeVolume).filter((v): v is number => v !== null);
    const mfeArr = obs.map((o) => o.maxFavorableMove);
    const maeArr = obs.map((o) => o.maxAdverseMove);

    return {
      totalSignals: signals.length,
      uniqueStocks: new Set(signals.map((s) => s.symbol)).size,
      averageReturn: averageReturn,
      medianReturn: medianReturn,
      winRate: winRate,
      maxFavorableExcursion: mfeArr.length ? Number(mean(mfeArr).toFixed(4)) : null,
      maxAdverseExcursion: maeArr.length ? Number(mean(maeArr).toFixed(4)) : null,
      avgRelativeVolume: relVols.length ? Number((sum(relVols) / relVols.length).toFixed(4)) : null,
      byRankBucket: {},
      byTimeOfDay: {},
    };
  }

  private async aggregateObservations(tradingDate: string): Promise<MonitorObservationDoc[]> {
    // fetch all observations for the day across active/completed monitors.
    const monitors = await this.deps.monitors.findActiveByDate(tradingDate);
    const monitorIds = monitors.map((m) => m._id!);
    const or: any[] = [];
    for (const id of monitorIds) or.push({ monitorId: id });
    if (or.length === 0) return [];
    const docs = await this.deps.observations.findMany({ $or: or });
    return docs as MonitorObservationDoc[];
  }
}
