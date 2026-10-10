# TopFlow.io

NIFTY 50 intraday momentum research & monitoring system.

**Informational only — no order placement.** This project monitors NIFTY 50
constituents, ranks them by intraday momentum, fires signals when a stock
enters the top-N with high relative volume, and tracks the outcome through
scheduled observations. It is a research tool, not a trading system.

## Architecture

```
app.ts  ->  MarketSessionScheduler  ->  SnapshotScheduler  ->  MarketDataProvider (mock/public/live)
                  |                        |
                  +-- SignalEngine         +-- MonitorScheduler
```

- **Providers** (`src/providers/`): `MockProvider` (deterministic, works
  offline), `PublicProvider` (REST stub), `GrowwProvider` (stub).
- **Repositories** (`src/repositories/`): thin MongoDB wrappers over the
  `mongodb` driver. `mongo.ts` handles connect/close/indexes and falls back to
  an in-memory `mongodb-memory-server` when `USE_MEMORY_SERVER=1`.
- **Services** (`src/services/`): ranking, momentum, VWAP, volume analytics,
  signal engine, monitor service, notification service.
- **Schedulers** (`src/scheduler/`): snapshot cadence, market open/close
  lifecycle, monitor observation polling.
- **Server** (`src/server/`): Fastify + `@fastify/websocket`. HTTP routes in
  `routes.ts`, live quote broadcast in `ws.ts`.

## Getting started

```bash
npm install
npm run build     # tsc
npm run lint      # eslint
npm test          # vitest
```

### Run the app

**Mock provider + in-memory MongoDB (no credentials, works offline):**

```bash
set USE_MEMORY_SERVER=1
set MARKET_DATA_PROVIDER=mock
npm start
```

**Real Atlas MongoDB (uses the `.env` file):**

```bash
set MARKET_DATA_PROVIDER=mock
npm start
```

The app starts the API on `PORT` (default 3000) and waits for the NSE market
window. Outside market hours it sleeps until the next open. To force the market
open immediately (e.g. for a Sunday demo), set:

```bash
set MARKET_FORCE_OPEN=1
set FORCE_OPEN_MINUTES=60
```

### Seed historical volume data

The relative-volume engine needs prior trading days to compute a baseline.
Run once after a fresh deploy:

```bash
npm run seed:history
```

This writes ~5 prior trading days of mock snapshots (skipping weekends and NSE
holidays) so signals can actually fire. It is idempotent.

### Seed history + run in one shot (demo)

```bash
set USE_MEMORY_SERVER=1
set MARKET_DATA_PROVIDER=mock
set NODE_ENV=development
npx tsx src/scripts/seedHistory.ts
set MARKET_FORCE_OPEN=1
npm start
```

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | liveness |
| GET | `/ready` | database / provider / market-session readiness |
| GET | `/api/session/current` | current trading session + top-N |
| GET | `/api/nifty50/live` | latest quote per NIFTY 50 stock |
| GET | `/api/nifty50/top-gainers` | ranked top gainers |
| GET | `/api/signals/today` | signals for the current trading day |
| GET | `/api/signals/:id` | single signal |
| GET | `/api/monitors/active` | active monitors |
| GET | `/api/monitors/:id` | monitor + observations |
| GET | `/api/analytics/today` | today's analytics |
| GET | `/api/config/strategy` | runtime strategy config |
| WS | `/ws/quotes` | live quote stream (snapshot on connect, then per-tick) |

## Configuration

All config lives in `.env` (see `.env.example`). Key flags:

| Variable | Default | Notes |
| --- | --- | --- |
| `MARKET_DATA_PROVIDER` | `mock` | `mock` \| `public` \| `live` |
| `MARKET_OPEN` | `09:15` | IST |
| `MARKET_CLOSE` | `15:30` | IST |
| `SNAPSHOT_INTERVAL_MS` | `10000` | snapshot cadence |
| `TOP_N` | `5` | top-N size for signals |
| `MIN_RELATIVE_VOLUME` | `1.5` | required relative volume |
| `MARKET_FORCE_OPEN` | `false` | demo/test override |
| `USE_MEMORY_SERVER` | `false` | ephemeral in-memory MongoDB |

## Testing

```bash
npm test          # vitest, unit tests under tests/unit/
```

## License

Informational research tool. Not financial advice. No order placement.