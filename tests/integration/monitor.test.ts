import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import { setTestDb, ensureIndexes } from '../../src/repositories/mongo.js';
import { MonitorRepository } from '../../src/repositories/MonitorRepository.js';
import { ObservationRepository } from '../../src/repositories/ObservationRepository.js';
import { SnapshotRepository } from '../../src/repositories/SnapshotRepository.js';
import { MonitorService } from '../../src/services/MonitorService.js';
import { TradingSessionService } from '../../src/services/TradingSessionService.js';
import { SignalRepository } from '../../src/repositories/SignalRepository.js';
import { isTradingDay } from '../../src/utils/time.js';
import { DateTime } from 'luxon';
import type { SignalDoc } from '../../src/models/Signal.js';

let memoryServer: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  client = new MongoClient(memoryServer.getUri());
  await client.connect();
  db = client.db('topflow-test');
  setTestDb(db);
  await ensureIndexes();
}, 60000);

afterAll(async () => {
  await client.close();
  await memoryServer.stop();
}, 60000);

beforeEach(async () => {
  await db.collection('monitors').deleteMany({});
  await db.collection('monitorObservations').deleteMany({});
  await db.collection('marketSnapshots').deleteMany({});
  await db.collection('signals').deleteMany({});
  await db.collection('tradingSessions').deleteMany({});
});

function makeSignal(symbol: string, price = 100): Omit<SignalDoc, '_id'> {
  const ts = new Date('2026-10-10T05:00:00.000Z');
  return {
    tradingDate: '2026-10-10',
    timestamp: ts,
    symbol,
    companyName: `${symbol} Ltd`,
    previousRank: null,
    currentRank: 1,
    previousTopN: [],
    currentTopN: [symbol],
    dayChangePercent: 2.5,
    volume: 1_000_000,
    relativeVolume: 2.5,
    priceAtSignal: price,
    vwap: price * 0.99,
    distanceFromVWAPPercent: 1.01,
    momentum5m: 1.2,
    momentum10m: 0.8,
    momentum15m: 0.5,
    triggerType: 'NEW_TOP_N_HIGH_VOL',
    conditions: {
      enteredTopN: true,
      highRelativeVolume: true,
      positive5mMomentum: true,
      positive10mMomentum: true,
      positive15mMomentum: true,
      aboveVWAP: true,
    },
    status: 'ACTIVE',
    createdAt: new Date(),
  };
}

describe('MonitorService', () => {
  it('creates a monitor with target observation times from env', async () => {
    const signals = new SignalRepository();
    const stored = await signals.upsert(makeSignal('RELIANCE'));
    const svc = new MonitorService({
      monitors: new MonitorRepository(),
      observations: new ObservationRepository(),
      snapshots: new SnapshotRepository(),
    });
    const m = await svc.createMonitor(stored);
    expect(m).not.toBeNull();
    expect(m?.symbol).toBe('RELIANCE');
    expect(m?.status).toBe('ACTIVE');
    expect(m?.targetObservationTimes).toContain('EOD');
  });

  it('is idempotent for the same signal', async () => {
    const signals = new SignalRepository();
    const stored = await signals.upsert(makeSignal('TCS'));
    const svc = new MonitorService({
      monitors: new MonitorRepository(),
      observations: new ObservationRepository(),
      snapshots: new SnapshotRepository(),
    });
    const a = await svc.createMonitor(stored);
    const b = await svc.createMonitor(stored);
    expect(b?._id?.toString()).toBe(a?._id?.toString());
  });

  it('records an observation once the target time has passed', async () => {
    // Seed snapshots after the signal so a price is available.
    const snapshots = new SnapshotRepository();
    const base = new Date('2026-10-10T05:00:00.000Z');
    for (let m = 0; m <= 35; m += 5) {
      await snapshots.upsert({
        tradingDate: '2026-10-10',
        timestamp: new Date(base.getTime() + m * 60_000),
        symbol: 'SBIN',
        companyName: 'SBI',
        ltp: 100 + m * 0.1,
        open: 100,
        high: 101,
        low: 99,
        previousClose: 100,
        dayChange: m * 0.1,
        dayChangePercent: m * 0.1,
        volume: 10_000 * (m + 1),
        averagePrice: 100,
        bestBid: 99.9,
        bestAsk: 100.1,
        source: 'mock',
        isStale: false,
        createdAt: new Date(),
      });
    }

    const signals = new SignalRepository();
    const stored = await signals.upsert(makeSignal('SBIN', 100));
    const obsRepo = new ObservationRepository();
    const svc = new MonitorService({
      monitors: new MonitorRepository(),
      observations: obsRepo,
      snapshots,
    });
    await svc.createMonitor(stored);

    // A cycle 6 minutes after the signal should record the 5M observation.
    const cycle = new Date(base.getTime() + 6 * 60_000);
    const recorded = await svc.checkObservations(cycle);
    expect(recorded).toBeGreaterThanOrEqual(1);

    const obs = await obsRepo.findByMonitor((await svc.loadActive('2026-10-10'))[0]._id!.toString());
    expect(obs.some((o) => o.observationType === '5M')).toBe(true);
  });

  it('finalizeAll records EOD and marks monitors completed', async () => {
    const snapshots = new SnapshotRepository();
    const base = new Date('2026-10-10T05:00:00.000Z');
    await snapshots.upsert({
      tradingDate: '2026-10-10',
      timestamp: new Date(base.getTime() + 60 * 60_000),
      symbol: 'HDFCBANK',
      companyName: 'HDFC Bank',
      ltp: 103,
      open: 100,
      high: 104,
      low: 99,
      previousClose: 100,
      dayChange: 3,
      dayChangePercent: 3,
      volume: 50_000,
      averagePrice: 101,
      bestBid: 102.9,
      bestAsk: 103.1,
      source: 'mock',
      isStale: false,
      createdAt: new Date(),
    });

    const signals = new SignalRepository();
    const stored = await signals.upsert(makeSignal('HDFCBANK', 100));
    const monitors = new MonitorRepository();
    const svc = new MonitorService({
      monitors,
      observations: new ObservationRepository(),
      snapshots,
    });
    const m = await svc.createMonitor(stored);

    const res = await svc.finalizeAll('2026-10-10', new Date(base.getTime() + 70 * 60_000));
    expect(res.monitors).toBe(1);

    const after = await monitors.findById(m!._id!.toString());
    expect(after?.status).toBe('COMPLETED');
  });
});

describe('TradingSessionService + market calendar', () => {
  it('opens and closes a session', async () => {
    const svc = new TradingSessionService();
    const opened = await svc.openSession('2026-10-10');
    expect(opened?.status).toBe('OPEN');
    const closed = await svc.closeSession('2026-10-10');
    expect(closed?.status).toBe('CLOSED');
  });

  it('skips NSE holidays as trading days', () => {
    // Christmas 2026 falls on a Friday.
    expect(isTradingDay(DateTime.fromISO('2026-12-25T10:00:00', { zone: 'Asia/Kolkata' }))).toBe(false);
    // Republic Day 2026 is a Monday.
    expect(isTradingDay(DateTime.fromISO('2026-01-26T10:00:00', { zone: 'Asia/Kolkata' }))).toBe(false);
    // A normal Monday.
    expect(isTradingDay(DateTime.fromISO('2026-10-12T10:00:00', { zone: 'Asia/Kolkata' }))).toBe(true);
  });
});
