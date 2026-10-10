import { env } from './config/env.js';
import logger from './utils/logger.js';
import { resetForcedOpen } from './utils/time.js';
import { connect, close, ensureIndexes, dbName } from './repositories/mongo.js';
import { InstrumentRepository } from './repositories/InstrumentRepository.js';
import { TradingSessionRepository } from './repositories/TradingSessionRepository.js';
import { SnapshotRepository } from './repositories/SnapshotRepository.js';
import { RankingRepository } from './repositories/RankingRepository.js';
import { SignalRepository } from './repositories/SignalRepository.js';
import { MonitorRepository } from './repositories/MonitorRepository.js';
import { ObservationRepository } from './repositories/ObservationRepository.js';
import { InstrumentService } from './services/InstrumentService.js';
import { SnapshotService } from './services/SnapshotService.js';
import { RankingService } from './services/RankingService.js';
import { TradingSessionService } from './services/TradingSessionService.js';
import { MarketDataService } from './services/MarketDataService.js';
import { VolumeAnalyticsService } from './services/VolumeAnalyticsService.js';
import { MomentumService } from './services/MomentumService.js';
import { VWAPService } from './services/VWAPService.js';
import { NotificationService } from './services/NotificationService.js';
import { SignalEngine } from './services/SignalEngine.js';
import { MonitorService } from './services/MonitorService.js';
import { AnalyticsService } from './services/AnalyticsService.js';
import { MarketSessionState } from './state/MarketSessionState.js';
import { SnapshotScheduler } from './scheduler/SnapshotScheduler.js';
import { MarketSessionScheduler } from './scheduler/MarketSessionScheduler.js';
import { MonitorScheduler } from './scheduler/MonitorScheduler.js';
import { createProvider } from './providers/ProviderFactory.js';
import { createServer } from './server/index.js';
import type { AppContainer } from './server/routes.js';

const uptimeStart = Date.now();

async function buildContainer(): Promise<{
  container: AppContainer;
  marketScheduler: MarketSessionScheduler;
  dataService: MarketDataService;
}> {
  await connect();
  await ensureIndexes();
  logger.info({ db: dbName() }, 'Database ready');

  const instruments = new InstrumentRepository();
  const instrumentService = new InstrumentService(instruments);
  const { seeded, total } = await instrumentService.seedNifty50();
  logger.info({ seeded, total, index: env.INDEX_NAME }, 'Instruments ready');
  const instrumentDocs = await instruments.findActiveByIndex(env.INDEX_NAME);
  if (instrumentDocs.length === 0) {
    throw new Error('No NIFTY 50 instruments loaded; cannot start');
  }

  const provider = createProvider(instrumentDocs);

  const dataService = new MarketDataService(provider);
  const snapshotService = new SnapshotService();
  const rankingService = new RankingService(env.TOP_N);
  const sessions = new TradingSessionRepository();
  const sessionService = new TradingSessionService(sessions);
  const state = new MarketSessionState();
  const snapshots = new SnapshotRepository();
  const rankings = new RankingRepository();
  const signals = new SignalRepository();
  const monitors = new MonitorRepository();
  const observations = new ObservationRepository();

  const volumeAnalytics = new VolumeAnalyticsService(snapshots);
  const momentumService = new MomentumService(state);
  const vwapService = new VWAPService(state);
  const notifications = new NotificationService();

  const signalEngine = new SignalEngine({
    volume: volumeAnalytics,
    momentum: momentumService,
    vwap: vwapService,
    signals,
    monitors,
    notifications,
  });

  const monitorService = new MonitorService({ monitors, observations, snapshots });
  const monitorScheduler = new MonitorScheduler(monitorService);

  const analyticsService = new AnalyticsService({ observations, signals, monitors, snapshots });

  const snapshotScheduler = new SnapshotScheduler({
    dataService,
    snapshotService,
    rankingService,
    instruments,
    sessions,
    rankings,
    state,
  });

  const marketScheduler = new MarketSessionScheduler({
    dataService,
    snapshotScheduler,
    sessionService,
    instruments,
    sessions,
    state,
    signalEngine,
    monitorScheduler,
  });

  const container: AppContainer = {
    dataService,
    sessionService,
    state,
    instrumentService,
    sessions,
    rankings,
    snapshots,
    signals,
    monitors,
    observations,
    analyticsService,
    snapshotScheduler,
    uptimeStart,
  };

  return { container, marketScheduler, dataService };
}

let shuttingDown = false;

async function main(): Promise<void> {
  logger.info({ provider: env.MARKET_DATA_PROVIDER, forceOpen: env.MARKET_FORCE_OPEN }, 'Starting TopFlow');

  const { container, marketScheduler, dataService } = await buildContainer();
  const server = await createServer(container);

  if (env.MARKET_FORCE_OPEN) resetForcedOpen();

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'SHUTDOWN', signal }, 'Shutting down');
    marketScheduler.stop();
    dataService.unsubscribeAll();
    await server.close();
    await close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start the market lifecycle (it waits for market open, or runs immediately
  // when MARKET_FORCE_OPEN is set for demo/testing).
  marketScheduler.start();

  await server.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'API server listening');
  logger.info('TopFlow MVP ready (informational signals only - no order placement)');
}

void main().catch((err) => {
  logger.error({ err }, 'Fatal error during startup');
  process.exit(1);
});
