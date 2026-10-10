import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

// The existing developer .env uses a legacy typo'd key (MONDODB_URI). Read both
// so we never have to touch the secret file directly.
const rawUri = process.env.MONGODB_URI || process.env.MONDODB_URI || '';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGODB_URI: z.string().optional(),
  MARKET_DATA_PROVIDER: z.enum(['mock', 'public', 'live']).default('mock'),
  MARKET_TIMEZONE: z.string().default('Asia/Kolkata'),
  MARKET_OPEN: z.string().regex(/^\d{2}:\d{2}$/).default('09:15'),
  MARKET_CLOSE: z.string().regex(/^\d{2}:\d{2}$/).default('15:30'),
  SNAPSHOT_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  INDEX_NAME: z.string().default('NIFTY50'),
  TOP_N: z.coerce.number().int().positive().default(5),
  MIN_RELATIVE_VOLUME: z.coerce.number().min(0).default(1.5),
  REQUIRE_POSITIVE_5M_MOMENTUM: z.coerce.boolean().default(true),
  REQUIRE_POSITIVE_10M_MOMENTUM: z.coerce.boolean().default(false),
  REQUIRE_ABOVE_VWAP: z.coerce.boolean().default(false),
  DATA_STALE_AFTER_SECONDS: z.coerce.number().int().positive().default(30),
  MAX_DATA_AGE_SECONDS: z.coerce.number().int().positive().default(30),
  GROWW_API_KEY: z.string().optional(),
  GROWW_API_SECRET: z.string().optional(),
  GROWW_ACCESS_TOKEN: z.string().optional(),
  RAW_DATA_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  MONGOMS_DISABLE: z.string().optional(),
  MONGODB_DB_NAME: z.string().default('topflow'),
  USE_MEMORY_SERVER: z.coerce.boolean().default(false),
  OBSERVATION_MINUTES: z.string().default('1,5,10,15,30'),
  // ---- Demo/test affordances (NOT for production runs) ----
  // When set, the market is treated as OPEN for a bounded window so the pipeline
  // can run outside real NSE hours (e.g. a Sunday). Real production runs leave
  // this unset and rely on the live market clock.
  MARKET_FORCE_OPEN: z.coerce.boolean().default(false),
  FORCE_OPEN_MINUTES: z.coerce.number().int().positive().default(15),
  // Number of prior synthetic trading days to seed for relative-volume history.
  MOCK_HISTORY_DAYS: z.coerce.number().int().min(0).default(5),
});

const parsed = envSchema.safeParse({
  ...process.env,
  MONGODB_URI: rawUri.length ? rawUri : process.env.MONGODB_URI,
});

if (!parsed.success) {
  console.error('Environment validation failed:', JSON.stringify(parsed.error.errors, null, 2));
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  isDev: parsed.data.NODE_ENV === 'development',
  observationMinutes: (parsed.data.OBSERVATION_MINUTES || '1,5,10,15,30')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n)),
};
