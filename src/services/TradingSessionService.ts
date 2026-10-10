import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { isTradingDay, nowIST, currentTradingDate, isoDate, todayOpen, todayClose, nextMarketOpen } from '../utils/time.js';
import { TradingSessionRepository } from '../repositories/TradingSessionRepository.js';
import type { TradingSessionDoc } from '../models/TradingSession.js';

export interface SessionState {
  tradingDate: string | null;
  status: 'IDLE' | 'OPEN' | 'CLOSED' | 'UPCOMING';
  sessionStart: Date | null;
  sessionEnd: Date | null;
  // ms until the next state transition (open or close)
  untilTransitionMs: number;
}

export class TradingSessionService {
  private repo: TradingSessionRepository;

  constructor(repo?: TradingSessionRepository) {
    this.repo = repo ?? new TradingSessionRepository();
  }

  /**
   * Determine the trading date that governs "now" during market hours, or the
   * most recent completed trading day otherwise. Returns null if no trading
   * day has occurred yet in history (no prior open).
   */
  currentTradingDate(): string | null {
    return currentTradingDate();
  }

  isMarketOpen(at = nowIST()): boolean {
    return (
      isTradingDay(at) &&
      at >= todayOpen(at) &&
      at < todayClose(at)
    );
  }

  currentWindow(): SessionState {
    const now = nowIST();
    if (!isTradingDay(now)) {
      const next = nextMarketOpen(now);
      const until = next ? next.toMillis() - now.toMillis() : 0;
      return {
        tradingDate: this.currentTradingDate(),
        status: 'UPCOMING',
        sessionStart: null,
        sessionEnd: null,
        untilTransitionMs: Math.max(0, until),
      };
    }
    const open = todayOpen(now);
    const close = todayClose(now);
    if (now < open) {
      return {
        tradingDate: now.toISODate(),
        status: 'UPCOMING',
        sessionStart: open.toJSDate(),
        sessionEnd: close.toJSDate(),
        untilTransitionMs: Math.max(0, open.toMillis() - now.toMillis()),
      };
    }
    if (now >= open && now < close) {
      return {
        tradingDate: now.toISODate(),
        status: 'OPEN',
        sessionStart: open.toJSDate(),
        sessionEnd: close.toJSDate(),
        untilTransitionMs: Math.max(0, close.toMillis() - now.toMillis()),
      };
    }
    // past close
    return {
      tradingDate: now.toISODate(),
      status: 'CLOSED',
      sessionStart: open.toJSDate(),
      sessionEnd: close.toJSDate(),
      untilTransitionMs: 0,
    };
  }

  private resolveTradingDate(dateStr?: string): string {
    return dateStr ?? this.currentTradingDate() ?? isoDate();
  }

  async ensureSession(dateStr?: string): Promise<TradingSessionDoc> {
    const tradingDate = this.resolveTradingDate(dateStr);
    return this.repo.findOrCreate(tradingDate);
  }

  async openSession(dateStr?: string): Promise<TradingSessionDoc | null> {
    const tradingDate = this.resolveTradingDate(dateStr);
    const existing = await this.repo.findByDate(tradingDate);
    if (existing && existing.status === 'OPEN') return existing;
    const now = new Date();
    logger.info({ tradingDate }, 'Opening trading session');
    return this.repo.findOrCreate(tradingDate, {
      timezone: env.MARKET_TIMEZONE,
      marketOpen: env.MARKET_OPEN,
      marketClose: env.MARKET_CLOSE,
      status: 'OPEN',
      startedAt: now,
    });
  }

  async closeSession(dateStr?: string): Promise<TradingSessionDoc | null> {
    const tradingDate = this.resolveTradingDate(dateStr);
    const now = new Date();
    logger.info({ tradingDate, snapshotCount: 0, signalCount: 0 }, 'Closing trading session');
    await this.repo.updateStatus(tradingDate, 'CLOSED', now);
    return this.repo.findByDate(tradingDate);
  }

  async setError(dateStr: string, error: string): Promise<void> {
    const now = new Date();
    await this.repo.findOrCreate(dateStr, { status: 'ERROR' });
    await this.repo.updateStatus(dateStr, 'ERROR', now);
    logger.error({ tradingDate: dateStr, error }, 'Trading session errored');
  }
}
