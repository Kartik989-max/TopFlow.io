import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import { InstrumentRepository } from '../repositories/InstrumentRepository.js';
import type { InstrumentInput, InstrumentDoc } from '../models/Instrument.js';

const nifty50Path = fileURLToPath(new URL('../config/nifty50.json', import.meta.url));
const nifty50 = JSON.parse(readFileSync(nifty50Path, 'utf8')) as Array<Record<string, string>>;

export class InstrumentService {
  constructor(private readonly repo: InstrumentRepository = new InstrumentRepository()) {}

  async seedNifty50(): Promise<{ seeded: number; total: number }> {
    const inputs: InstrumentInput[] = (nifty50 as Array<Record<string, string>>).map((r) => ({
      symbol: r.symbol,
      companyName: r.companyName,
      exchange: r.exchange ?? 'NSE',
      segment: r.segment ?? 'CASH',
      instrumentToken: r.instrumentToken,
      active: true,
      indexMembership: [env.INDEX_NAME],
    }));

    const existing = await this.repo.findActiveByIndex(env.INDEX_NAME);
    const existingSymbols = new Set(existing.map((i) => i.symbol));
    let seeded = 0;
    for (const input of inputs) {
      if (!existingSymbols.has(input.symbol)) {
        await this.repo.upsert(input);
        seeded++;
      } else {
        // keep indexMembership current + active
        await this.repo.updateIndexMembership(input.symbol, input.indexMembership);
      }
    }
    // mark any previously-active constituents not in current list as inactive
    for (const old of existing) {
      if (!inputs.find((i) => i.symbol === old.symbol)) {
        await this.repo.deactivate(old.symbol);
      }
    }
    logger.info({ seeded, total: inputs.length, index: env.INDEX_NAME }, 'Instruments seeded');
    return { seeded, total: inputs.length };
  }

  async loadActiveInstruments(index = env.INDEX_NAME): Promise<InstrumentDoc[]> {
    return this.repo.findActiveByIndex(index);
  }
}
