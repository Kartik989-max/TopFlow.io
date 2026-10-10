import { MongoClient, Db, Collection, Document } from 'mongodb';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;
let memoryServer: any = null;

const DB_NAME = env.MONGODB_DB_NAME;

export function getDb(): Db {
  if (!cachedDb) throw new Error('MongoDB not connected. Call connect() first.');
  return cachedDb;
}

// For tests: inject an already-connected Db (e.g. to mongodb-memory-server).
export function setTestDb(db: Db): void {
  cachedDb = db;
}

export function getCollection<T extends Document>(name: string): Collection<T> {
  return getDb().collection<T>(name);
}

export function dbName(): string {
  return DB_NAME;
}

export async function connect(): Promise<Db> {
  if (cachedDb) return cachedDb;

  const uri = env.MONGODB_URI;
  try {
    if (uri && !env.USE_MEMORY_SERVER) {
      cachedClient = new MongoClient(uri, {
        serverSelectionTimeoutMS: 8000,
        maxIdleTimeMS: 60000,
        // Never log server responses that could echo credentials.
        monitorCommands: false,
      });
      await cachedClient.connect();
      cachedDb = cachedClient.db(DB_NAME);
      logger.info({ db: DB_NAME }, 'Connected to MongoDB');
    } else {
      // Dev/test fallback: ephemeral in-memory mongod.
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      cachedClient = new MongoClient(memoryServer.getUri());
      await cachedClient.connect();
      cachedDb = cachedClient.db(DB_NAME);
      logger.info({ db: DB_NAME, inMemory: true }, 'Connected to in-memory MongoDB');
    }
  } catch (err) {
    logger.error({ err, inMemory: !uri }, 'MongoDB connection failed');
    throw err;
  }
  return cachedDb;
}

export async function close(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
  logger.info('MongoDB connection closed');
}

export async function ensureIndexes(): Promise<void> {
  const db = getDb();
  try {
    await db.collection('instruments').createIndexes([
      { key: { symbol: 1, exchange: 1 }, unique: true, name: 'symbol_exchange_unique' },
      { key: { active: 1 }, name: 'active_idx' },
      { key: { indexMembership: 1 }, name: 'indexMembership_idx' },
    ]);

    await db.collection('tradingSessions').createIndex(
      { tradingDate: 1 },
      { unique: true, name: 'tradingDate_unique' },
    );

    await db.collection('marketSnapshots').createIndexes([
      { key: { tradingDate: 1, timestamp: 1, symbol: 1 }, unique: true, name: 'ts_symbol_unique' },
      { key: { symbol: 1, tradingDate: 1, timestamp: 1 }, name: 'symbol_date_ts_idx' },
    ]);

    await db.collection('rankingSnapshots').createIndex(
      { tradingDate: 1, timestamp: 1 },
      { unique: true, name: 'ranking_ts_unique' },
    );

    // Idempotent signal key: spec 47 -> tradingDate + symbol + signalTimestamp + triggerType
    await db.collection('signals').createIndex(
      { tradingDate: 1, symbol: 1, timestamp: 1, triggerType: 1 },
      { unique: true, name: 'signal_dedup_unique' },
    );

    await db.collection('monitors').createIndexes([
      { key: { signalId: 1 }, unique: true, name: 'signalId_unique' },
      { key: { tradingDate: 1, status: 1 }, name: 'session_status_idx' },
    ]);

    await db.collection('monitorObservations').createIndex(
      { monitorId: 1, observationType: 1 },
      { unique: true, name: 'monitor_obs_unique' },
    );

    await db.collection('systemEvents').createIndex({ createdAt: 1 }, { name: 'created_at_idx' });

    logger.info('Indexes ensured');
  } catch (err) {
    logger.error({ err }, 'Failed ensuring indexes');
    throw err;
  }
}
