import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { round } from '../utils/math.js';
import { isoDate } from '../utils/time.js';
import type { MonitorRepository } from '../repositories/MonitorRepository.js';
import type { ObservationRepository } from '../repositories/ObservationRepository.js';
import type { SnapshotRepository } from '../repositories/SnapshotRepository.js';
import type { MonitorObservationDoc, ObservationType } from '../models/MonitorObservation.js';
import type { MonitorDoc } from '../models/Monitor.js';
import type { SignalDoc } from '../models/Signal.js';

const OBSERVATION_OFFSETS: Record<ObservationType, number> = {
  '1M': 60_000,
  '5M': 300_000,
  '10M': 600_000,
  '15M': 900_000,
  '30M': 1_800_000,
  EOD: 0,
};

export class MonitorService {
  constructor(private readonly deps: {
    monitors: MonitorRepository;
    observations: ObservationRepository;
    snapshots: SnapshotRepository;
  }) {}

  async createMonitor(signal: SignalDoc): Promise<MonitorDoc | null> {
    const signalId = signal._id;
    if (!signalId) return null;

    // Avoid duplicate monitors for the same signal (spec 47).
    const existing = await this.deps.monitors.findOne({ signalId });
    if (existing) return existing;

    const monitor: Omit<MonitorDoc, '_id'> = {
      signalId,
      tradingDate: signal.tradingDate,
      symbol: signal.symbol,
      signalTimestamp: signal.timestamp,
      signalPrice: signal.priceAtSignal,
      monitoringStartedAt: new Date(),
      monitoringEndedAt: null,
      status: 'ACTIVE',
      targetObservationTimes: [
        ...env.observationMinutes.map((m) => `${m}M` as ObservationType),
        'EOD',
      ],
      completedObservationTimes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const stored = await this.deps.monitors.upsert(monitor);
    logger.info({ event: 'MONITOR_STARTED', symbol: stored.symbol, monitorId: stored._id?.toString() }, 'Monitor created');
    return stored;
  }

  // Called every cycle. Records an observation once its target time has passed.
  async checkObservations(cycleTimestamp: Date): Promise<number> {
    const tradingDate = isoDate(DateTime.fromJSDate(cycleTimestamp, { zone: env.MARKET_TIMEZONE }));
    const active = await this.deps.monitors.findActiveByDate(tradingDate);
    let recorded = 0;
    for (const m of active) {
      for (const type of m.targetObservationTimes as ObservationType[]) {
        if (m.completedObservationTimes.includes(type)) continue;
        if (type === 'EOD') continue; // EOD is recorded only at market close
        const target = this.targetTime(m, type);
        if (cycleTimestamp >= target) {
          await this.recordObservation(m, type, target);
          recorded++;
        }
      }
    }
    return recorded;
  }

  private async recordObservation(monitor: MonitorDoc, type: ObservationType, targetTs: Date): Promise<void> {
    const price = await this.priceAt(monitor.symbol, monitor.tradingDate, targetTs);
    if (price === undefined) return; // skip until data available at/around target
    const { percentChange, maxFavorableMove, maxAdverseMove } = await this.moves(monitor, targetTs, price);
    const volume = await this.lastVolume(monitor.symbol, monitor.tradingDate, targetTs);
    const obs: Omit<MonitorObservationDoc, '_id'> = {
      monitorId: monitor._id!,
      signalId: monitor.signalId,
      tradingDate: monitor.tradingDate,
      symbol: monitor.symbol,
      observationType: type,
      observationTimestamp: targetTs,
      price,
      absoluteChange: round(price - monitor.signalPrice, 4),
      percentChange,
      maxFavorableMove,
      maxAdverseMove,
      volume,
      source: 'live',
      createdAt: new Date(),
    };
    await this.deps.observations.upsert(obs);
    await this.deps.monitors.markObservationDone(monitor._id!.toString(), type);
    logger.info(
      { event: 'OBSERVATION_RECORDED', symbol: monitor.symbol, type, percentChange, price },
      'Observation recorded',
    );
  }

  private signalTs(monitor: MonitorDoc): Date {
    return monitor.signalTimestamp instanceof Date
      ? monitor.signalTimestamp
      : new Date(monitor.signalTimestamp);
  }

  private targetTime(monitor: MonitorDoc, type: ObservationType): Date {
    const base = this.signalTs(monitor);
    if (type === 'EOD') return base; // EOD resolved at close via closeTs
    return new Date(base.getTime() + (OBSERVATION_OFFSETS[type] ?? 0));
  }

  private async priceAt(symbol: string, tradingDate: string, ts: Date): Promise<number | undefined> {
    // prefer a snapshot at/nlightly after ts
    const eps = 15_000;
    const docs = await this.deps.snapshots.findPriceHistory(
      tradingDate,
      symbol,
      new Date(ts.getTime() - eps),
      new Date(ts.getTime() + eps),
    );
    if (docs.length > 0) {
      // nearest
      let best = docs[0];
      for (const d of docs) {
        if (Math.abs(d.timestamp.getTime() - ts.getTime()) < Math.abs(best.timestamp.getTime() - ts.getTime())) best = d;
      }
      return best.ltp;
    }
    return undefined;
  }

  private async moves(
    monitor: MonitorDoc,
    until: Date,
    price: number,
  ): Promise<{ percentChange: number; maxFavorableMove: number; maxAdverseMove: number }> {
    const signalPrice = monitor.signalPrice;
    if (signalPrice <= 0) return { percentChange: 0, maxFavorableMove: 0, maxAdverseMove: 0 };
    const pct = round((price / signalPrice - 1) * 100, 4);
    // Approx MFE/MAE over window from snapshots.
    const from = this.signalTs(monitor);
    const docs = await this.deps.snapshots.findPriceHistory(monitor.tradingDate, monitor.symbol, from, until);
    let best = price;
    let worst = price;
    for (const d of docs) {
      if (d.ltp > best) best = d.ltp;
      if (d.ltp < worst) worst = d.ltp;
    }
    const mfe = round(((best / signalPrice - 1) * 100), 4);
    const mae = round(((worst / signalPrice - 1) * 100), 4);
    return { percentChange: pct, maxFavorableMove: mfe, maxAdverseMove: mae };
  }

  private async lastVolume(symbol: string, tradingDate: string, ts: Date): Promise<number | null> {
    const eps = 15_000;
    const docs = await this.deps.snapshots.findPriceHistory(
      tradingDate,
      symbol,
      new Date(ts.getTime() - eps),
      new Date(ts.getTime() + eps),
    );
    return docs.length ? docs[docs.length - 1].volume : null;
  }

  async finalizeAll(tradingDate: string, closeTs: Date): Promise<{ monitors: number; observations: number }> {
    const active = await this.deps.monitors.findActiveByDate(tradingDate);
    let obs = 0;
    // ensure EOD observations
    for (const m of active) {
      if (!m.completedObservationTimes.includes('EOD')) {
        const price = await this.priceAt(m.symbol, tradingDate, closeTs);
        if (price !== undefined) {
          await this.recordObservation(m, 'EOD' as ObservationType, closeTs);
          obs++;
        }
      }
      // backfill any missed intermediate observations
      for (const type of m.targetObservationTimes as ObservationType[]) {
        if (type === 'EOD') continue;
        if (m.completedObservationTimes.includes(type)) continue;
        const target = this.targetTime(m, type);
        const price = await this.priceAt(m.symbol, tradingDate, target);
        if (price !== undefined) {
          const source: MonitorObservationDoc['source'] = 'backfilled';
          const doc = await this.buildObs(m, type, target, price, closeTs);
          await this.deps.observations.upsert({ ...doc, source });
          await this.deps.monitors.markObservationDone(m._id!.toString(), type);
          obs++;
        }
      }
      await this.deps.monitors.markCompleted(m._id!.toString(), closeTs);
    }
    logger.info({ event: 'SESSION_END', tradingDate, monitors: active.length, observations: obs }, 'Monitors finalized');
    return { monitors: active.length, observations: obs };
  }

  private async buildObs(
    monitor: MonitorDoc,
    type: ObservationType,
    targetTs: Date,
    price: number,
    until: Date,
  ): Promise<Omit<MonitorObservationDoc, '_id'>> {
    const { percentChange, maxFavorableMove, maxAdverseMove } = await this.moves(monitor, until, price);
    const volume = await this.lastVolume(monitor.symbol, monitor.tradingDate, targetTs);
    return {
      monitorId: monitor._id!,
      signalId: monitor.signalId,
      tradingDate: monitor.tradingDate,
      symbol: monitor.symbol,
      observationType: type,
      observationTimestamp: targetTs,
      price,
      absoluteChange: round(price - monitor.signalPrice, 4),
      percentChange,
      maxFavorableMove,
      maxAdverseMove,
      volume,
      source: 'live',
      createdAt: new Date(),
    };
  }

  async loadActive(tradingDate: string): Promise<MonitorDoc[]> {
    return this.deps.monitors.findActiveByDate(tradingDate);
  }
}
