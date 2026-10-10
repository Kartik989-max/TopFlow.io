import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import { env } from '../../src/config/env.js';
import { connect, close, setTestDb, ensureIndexes } from '../../src/repositories/mongo.js';
import { InstrumentRepository } from '../../src/repositories/InstrumentRepository.js';
import { InstrumentService } from '../../src/services/InstrumentService.js';
import { SnapshotRepository } from '../../src/repositories/SnapshotRepository.js';
import { SignalEngine } from '../../src/services/SignalEngine.js';
import { SignalRepository } from '../../src/repositories/SignalRepository.js';

let memoryServer: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  client = new MongoClient(memoryServer.getUri());
  await client.connect();
  const db = client.db('topflow-test');
  setTestDb(db);
  await ensureIndexes();
}, 60000);

afterAll(async () => {
  await client.close();
  await memoryServer.stop();
}, 60000);

describe('pipeline: seed instruments + signals', () => {
  beforeEach(async () => {
    const db = client.db('topflow-test');
    await db.collection('instruments').deleteMany({});
    await db.collection('signals').deleteMany({});
  });

  it('seeds 52 NIFTY 50 instruments', async () => {
    const repo = new InstrumentRepository();
    const svc = new InstrumentService(repo);
    const { total } = await svc.seedNifty50();
    expect(total).toBe(52);
    const active = await repo.findActiveByIndex(env.INDEX_NAME);
    expect(active).toHaveLength(52);
  });

  it('idempotent seeding does not duplicate instruments', async () => {
    const repo = new InstrumentRepository();
    const svc = new InstrumentService(repo);
    await svc.seedNifty50();
    await svc.seedNifty50();
    const count = await repo.count({ active: true, indexMembership: env.INDEX_NAME });
    expect(count).toBe(52);
  });

  it('does not fire a signal without relative volume history', async () => {
    const repo = new InstrumentRepository();
    const svc = new InstrumentService(repo);
    await svc.seedNifty50();
    const inst = await repo.findActiveByIndex(env.INDEX_NAME);

    const signals = new SignalRepository();
    const observers: unknown[] = [];
    let engine: SignalEngine | undefined;
    const monitorRepo = {
      findOne: async () => null,
      upsert: async (m: unknown) => { observers.push(m); return m; },
    } as any;

    engine = new SignalEngine({
      volume: {
        calculateRelativeVolume: async () => null, // no history
        getVolumeProfile: async () => [],
        getHistoricalVolumeCurve: async () => [],
      } as any,
      momentum: { get5m: () => 1, get10m: () => 1, get15m: () => 1 } as any,
      vwap: { vwap: () => 100, distanceFromVWAPPercent: () => 1 } as any,
      signals,
      monitors: monitorRepo,
      notifications: { notifySignal: () => {} } as any,
    });

    const snapshot = {
      tradingDate: '2026-10-10',
      timestamp: new Date(),
      symbol: 'RELIANCE',
      companyName: 'Reliance Industries',
      ltp: 3000,
      open: 2900,
      high: 3010,
      low: 2890,
      previousClose: 2900,
      dayChange: 100,
      dayChangePercent: 3.4,
      volume: 1_000_000,
      averagePrice: 2950,
      bestBid: 2999,
      bestAsk: 3001,
      source: 'mock' as const,
      isStale: false,
      createdAt: new Date(),
    };

    const signal = await engine.evaluateNewEntry(
      {
        symbol: 'RELIANCE',
        snapshot: snapshot as any,
        newEntrant: { symbol: 'RELIANCE', rank: 1, dayChangePercent: 3.4, volume: 1_000_000 },
        previousTopN: ['TATAMOTORS'],
        currentTopN: ['RELIANCE'],
      },
      new Date(),
    );

    expect(signal).toBeNull();
    const stored = await signals.findToday('2026-10-10');
    expect(stored).toHaveLength(0);
  });

  it('fires a signal when all conditions are met', async () => {
    const repo = new InstrumentRepository();
    const svc = new InstrumentService(repo);
    await svc.seedNifty50();

    const signals = new SignalRepository();
    const engine = new SignalEngine({
      volume: {
        calculateRelativeVolume: async () => 2.5,
        getVolumeProfile: async () => [],
        getHistoricalVolumeCurve: async () => [],
      } as any,
      momentum: { get5m: () => 1.2, get10m: () => 0.8, get15m: () => 0.5 } as any,
      vwap: { vwap: () => 2980, distanceFromVWAPPercent: () => 0.67 } as any,
      signals,
      monitors: { findOne: async () => null, upsert: async (m: unknown) => ({ _id: null, ...(m as object) }) } as any,
      notifications: { notifySignal: () => {} } as any,
    });

    const snapshot = {
      tradingDate: '2026-10-10',
      timestamp: new Date(),
      symbol: 'RELIANCE',
      companyName: 'Reliance Industries',
      ltp: 3000,
      open: 2900,
      high: 3010,
      low: 2890,
      previousClose: 2900,
      dayChange: 100,
      dayChangePercent: 3.4,
      volume: 1_000_000,
      averagePrice: 2950,
      bestBid: 2999,
      bestAsk: 3001,
      source: 'mock' as const,
      isStale: false,
      createdAt: new Date(),
    };

    const signal = await engine.evaluateNewEntry(
      {
        symbol: 'RELIANCE',
        snapshot: snapshot as any,
        newEntrant: { symbol: 'RELIANCE', rank: 1, dayChangePercent: 3.4, volume: 1_000_000 },
        previousTopN: ['TATAMOTORS'],
        currentTopN: ['RELIANCE'],
      },
      new Date(),
    );

    expect(signal).not.toBeNull();
    expect(signal?.symbol).toBe('RELIANCE');
    expect(signal?.triggerType).toBe('NEW_TOP_N_HIGH_VOL');

    const stored = await signals.findToday('2026-10-10');
    expect(stored).toHaveLength(1);
    expect(stored[0].relativeVolume).toBeCloseTo(2.5, 5);
  });

  it('does not fire when momentum requirement is unmet', async () => {
    const signals = new SignalRepository();
    const engine = new SignalEngine({
      volume: { calculateRelativeVolume: async () => 3 } as any,
      momentum: { get5m: () => -0.5, get10m: () => -0.5, get15m: () => -0.5 } as any,
      vwap: { vwap: () => 100, distanceFromVWAPPercent: () => 1 } as any,
      signals,
      monitors: { findOne: async () => null, upsert: async (m: unknown) => ({ _id: null, ...(m as object) }) } as any,
      notifications: { notifySignal: () => {} } as any,
    });

    const snapshot = {
      tradingDate: '2026-10-10',
      timestamp: new Date(),
      symbol: 'INFY',
      companyName: 'Infosys',
      ltp: 2000,
      open: 1950,
      high: 2010,
      low: 1940,
      previousClose: 1950,
      dayChange: 50,
      dayChangePercent: 2.5,
      volume: 500_000,
      averagePrice: 1975,
      bestBid: 1999,
      bestAsk: 2001,
      source: 'mock' as const,
      isStale: false,
      createdAt: new Date(),
    };

    const signal = await engine.evaluateNewEntry(
      {
        symbol: 'INFY',
        snapshot: snapshot as any,
        newEntrant: { symbol: 'INFY', rank: 2, dayChangePercent: 2.5, volume: 500_000 },
        previousTopN: ['RELIANCE'],
        currentTopN: ['RELIANCE', 'INFY'],
      },
      new Date(),
    );

    expect(signal).toBeNull();
  });
});
