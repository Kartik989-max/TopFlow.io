import { MockProvider } from './MockProvider.js';
import { GrowwProvider } from './GrowwProvider.js';
import { PublicProvider } from './PublicProvider.js';
import { env } from '../config/env.js';
import type { MarketDataProvider } from './MarketDataProvider.js';
import type { InstrumentDoc } from '../models/Instrument.js';
import logger from '../utils/logger.js';

export function createProvider(instruments: InstrumentDoc[]): MarketDataProvider {
  switch (env.MARKET_DATA_PROVIDER) {
    case 'live': {
      const p = new GrowwProvider();
      logger.info('Using Groww live provider');
      return p;
    }
    case 'public': {
      const p = new PublicProvider();
      logger.info('Using best-effort public provider');
      return p;
    }
    case 'mock':
    default: {
      const p = new MockProvider();
      (p as any).loadInstruments(instruments);
      logger.info('Using Mock provider');
      return p;
    }
  }
}
