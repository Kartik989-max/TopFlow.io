import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import type { MarketSnapshotDoc } from '../models/MarketSnapshot.js';
import type { SignalDoc } from '../models/Signal.js';
import { type SignalRepository } from '../repositories/SignalRepository.js';
import { type MonitorRepository } from '../repositories/MonitorRepository.js';
import type { VolumeAnalyticsService } from './VolumeAnalyticsService.js';
import type { MomentumService } from './MomentumService.js';
import type { VWAPService } from './VWAPService.js';
import type { NotificationService } from './NotificationService.js';

const OBSERVATION_TIMES = ['1M', '5M', '10M', '15M', '30M', 'EOD'] as const;

export interface SignalCandidate {
  symbol: string;
  snapshot: MarketSnapshotDoc;
  newEntrant: { symbol: string; rank: number; dayChangePercent: number; volume: number };
  previousTopN: string[];
  currentTopN: string[];
}

export class SignalEngine {
  constructor(private readonly deps: {
    volume: VolumeAnalyticsService;
    momentum: MomentumService;
    vwap: VWAPService;
    signals: SignalRepository;
    monitors: MonitorRepository;
    notifications: NotificationService;
  }) {}

  async evaluateNewEntry(candidate: SignalCandidate, now: Date): Promise<SignalDoc | null> {
    const { symbol, snapshot, newEntrant } = candidate;
    const tradingDate = snapshot.tradingDate;
    const { DateTime } = await import('luxon');
    const ist = DateTime.fromJSDate(now, { zone: env.MARKET_TIMEZONE });
    const mod = ist.hour * 60 + ist.minute;

    const relativeVolume = await this.deps.volume.calculateRelativeVolume(
      symbol,
      tradingDate,
      mod,
      snapshot.volume,
    );

    const momentum5m = this.deps.momentum.get5m(symbol);
    const momentum10m = this.deps.momentum.get10m(symbol);
    const momentum15m = this.deps.momentum.get15m(symbol);
    const vwap = this.deps.vwap.vwap(symbol);
    const distFromVwap = this.deps.vwap.distanceFromVWAPPercent(symbol);
    const aboveVWAP = vwap !== null && snapshot.ltp > vwap;

    const conditions = {
      enteredTopN: true,
      highRelativeVolume: relativeVolume !== null && relativeVolume >= env.MIN_RELATIVE_VOLUME,
      positive5mMomentum: !!momentum5m && momentum5m > 0,
      positive10mMomentum: !!momentum10m && momentum10m > 0,
      positive15mMomentum: !!momentum15m && momentum15m > 0,
      aboveVWAP,
    };

    const passed = this.conditionsMet(conditions, relativeVolume);
    if (!passed) return null;

    const signal: Omit<SignalDoc, '_id'> = {
      tradingDate,
      timestamp: snapshot.timestamp,
      symbol,
      companyName: snapshot.companyName,
      previousRank: newEntrant.rank > 1 ? null : null,
      currentRank: newEntrant.rank,
      previousTopN: candidate.previousTopN,
      currentTopN: candidate.currentTopN,
      dayChangePercent: snapshot.dayChangePercent,
      volume: snapshot.volume,
      relativeVolume,
      priceAtSignal: snapshot.ltp,
      vwap,
      distanceFromVWAPPercent: distFromVwap,
      momentum5m,
      momentum10m,
      momentum15m,
      triggerType: 'NEW_TOP_N_HIGH_VOL',
      conditions,
      status: 'ACTIVE',
      createdAt: new Date(),
    };

    try {
      const stored = await this.deps.signals.upsert(signal);
      this.deps.notifications.notifySignal(stored);
      logger.info(
        {
          event: 'SIGNAL_CREATED',
          symbol,
          relativeVolume,
          momentum5m,
          rank: newEntrant.rank,
          changePercent: snapshot.dayChangePercent,
        },
        'Signal created',
      );
    } catch (err) {
      logger.error({ err, symbol, event: 'SIGNAL_CREATE_FAILED' }, 'Failed to persist signal');
      return null;
    }

    return signal;
  }

  private conditionsMet(
    conditions: {
      enteredTopN: boolean;
      highRelativeVolume: boolean;
      positive5mMomentum: boolean;
      positive10mMomentum: boolean;
      positive15mMomentum: boolean;
      aboveVWAP: boolean;
    },
    relativeVolume: number | null,
  ): boolean {
    if (!conditions.enteredTopN) return false;
    // High relative volume is mandatory (spec 17). Without history we cannot
    // confirm it, so we never fabricate a signal.
    if (!conditions.highRelativeVolume) return false;
    if (relativeVolume === null) return false;

    if (env.REQUIRE_POSITIVE_5M_MOMENTUM && !conditions.positive5mMomentum) return false;
    if (env.REQUIRE_POSITIVE_10M_MOMENTUM && !conditions.positive10mMomentum) return false;
    if (env.REQUIRE_ABOVE_VWAP && !conditions.aboveVWAP) return false;
    return true;
  }

  observationTimes(): string[] {
    return [...OBSERVATION_TIMES];
  }
}
