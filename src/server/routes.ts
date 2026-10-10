import type { FastifyPluginAsync } from 'fastify';
import { env } from '../config/env.js';
import { isMarketOpen, currentTradingDate } from '../utils/time.js';
import type { MarketDataService } from '../services/MarketDataService.js';
import type { TradingSessionService } from '../services/TradingSessionService.js';
import type { MarketSessionState } from '../state/MarketSessionState.js';
import type { InstrumentService } from '../services/InstrumentService.js';
import type { TradingSessionRepository } from '../repositories/TradingSessionRepository.js';
import type { RankingRepository } from '../repositories/RankingRepository.js';
import type { SnapshotRepository } from '../repositories/SnapshotRepository.js';
import type { SignalRepository } from '../repositories/SignalRepository.js';
import type { MonitorRepository } from '../repositories/MonitorRepository.js';
import type { ObservationRepository } from '../repositories/ObservationRepository.js';
import type { AnalyticsService } from '../services/AnalyticsService.js';
import type { SnapshotScheduler } from '../scheduler/SnapshotScheduler.js';

export interface AppContainer {
  dataService: MarketDataService;
  sessionService: TradingSessionService;
  state: MarketSessionState;
  instrumentService: InstrumentService;
  sessions: TradingSessionRepository;
  rankings: RankingRepository;
  snapshots: SnapshotRepository;
  signals: SignalRepository;
  monitors: MonitorRepository;
  observations: ObservationRepository;
  analyticsService: AnalyticsService;
  snapshotScheduler: SnapshotScheduler;
  uptimeStart: number;
}

export const registerRoutes: FastifyPluginAsync<{ container: AppContainer }> = async (
  app,
  opts,
) => {
  const c = opts.container;

  app.get('/health', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      uptime: Math.floor((Date.now() - c.uptimeStart) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_req, reply) => {
    let dbOk = true;
    try {
      await c.snapshots.count();
    } catch {
      dbOk = false;
    }
    let providerOk = false;
    let sessionOk = false;
    try {
      providerOk = await c.dataService.healthCheck();
    } catch {
      providerOk = false;
    }
    try {
      sessionOk = isMarketOpen();
    } catch {
      sessionOk = false;
    }
    return reply.send({ database: dbOk, marketDataProvider: providerOk, marketSession: sessionOk });
  });

  app.get('/api/session/current', async (_req, reply) => {
    const session = await c.sessions.findActive();
    return reply.send({
      tradingDate: c.state.tradingDate,
      status: c.state.status,
      currentTopN: c.state.currentTopN,
      previousTopN: c.state.previousTopN,
      snapshotCount: c.state.snapshotCount,
      lastSnapshotAt: c.state.lastSnapshotAt,
      marketOpen: isMarketOpen(),
      session: session,
    });
  });

  app.get('/api/nifty50/live', async (_req, reply) => {
    const quotes = c.dataService.getAllQuotes();
    const rows = [...quotes.values()].map((q) => ({
      symbol: q.symbol,
      ltp: q.ltp,
      dayChangePercent: q.dayChangePercent,
      dayChange: q.dayChange,
      volume: q.volume,
      averagePrice: q.averagePrice,
      bestBid: q.bestBid,
      bestAsk: q.bestAsk,
      isStale: c.dataService.isStale(q.symbol),
      receivedAt: q.receivedAt,
    }));
    return reply.send({ count: rows.length, quotes: rows });
  });

  app.get('/api/nifty50/top-gainers', async (_req, reply) => {
    const latest = await c.rankings.findLatest(c.state.tradingDate ?? '');
    if (!latest) {
      return reply.send({ topGainers: c.state.currentTopN.map((s, i) => ({ rank: i + 1, symbol: s })) });
    }
    return reply.send({
      timestamp: latest.timestamp,
      topGainers: latest.topGainers.slice(0, env.TOP_N),
      all: latest.allRankedSymbols.slice(0, 10),
    });
  });

  app.get('/api/signals/today', async (_req, reply) => {
    const date = c.state.tradingDate ?? currentTradingDate() ?? '';
    const list = await c.signals.findToday(date);
    return reply.send({ tradingDate: date, count: list.length, signals: list });
  });

  app.get('/api/signals/:id', async (req, reply) => {
    const doc = await c.signals.findById((req.params as { id: string }).id);
    if (!doc) return reply.code(404).send({ error: 'not found' });
    return reply.send(doc);
  });

  app.get('/api/monitors/active', async (_req, reply) => {
    const date = c.state.tradingDate ?? '';
    const monitors = await c.monitors.findActiveByDate(date);
    return reply.send({ tradingDate: date, count: monitors.length, monitors });
  });

  app.get('/api/monitors/:id', async (req, reply) => {
    const m = await c.monitors.findById((req.params as { id: string }).id);
    if (!m) return reply.code(404).send({ error: 'not found' });
    const obs = await c.observations.findByMonitor(m._id!.toString());
    return reply.send({ monitor: m, observations: obs });
  });

  app.get('/api/analytics/today', async (_req, reply) => {
    const date = c.state.tradingDate ?? '';
    const analytics = await c.analyticsService.today(date || '1970-01-01');
    return reply.send(analytics);
  });

  app.get('/api/analytics/strategy', async (_req, reply) => {
    const date = c.state.tradingDate ?? '';
    const analytics = await c.analyticsService.today(date || '1970-01-01');
    return reply.send(analytics);
  });

  app.get('/api/config/strategy', async (_req, reply) => {
    return reply.send({
      topN: env.TOP_N,
      snapshotIntervalSeconds: env.SNAPSHOT_INTERVAL_MS / 1000,
      minRelativeVolume: env.MIN_RELATIVE_VOLUME,
      requirePositive5mMomentum: env.REQUIRE_POSITIVE_5M_MOMENTUM,
      requirePositive10mMomentum: env.REQUIRE_POSITIVE_10M_MOMENTUM,
      requireAboveVWAP: env.REQUIRE_ABOVE_VWAP,
      observationMinutes: env.observationMinutes,
      provider: env.MARKET_DATA_PROVIDER,
      marketOpen: env.MARKET_OPEN,
      marketClose: env.MARKET_CLOSE,
      forceOpen: env.MARKET_FORCE_OPEN,
    });
  });
};
