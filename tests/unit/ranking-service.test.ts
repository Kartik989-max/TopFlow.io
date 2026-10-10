import type { MarketSnapshotDoc } from '../../src/models/MarketSnapshot.js';
import { RankingService, type TopNChange } from '../../src/services/RankingService.js';

export function makeSnapshot(symbol: string, pct: number, volume = 100000): MarketSnapshotDoc {
  return {
    _id: undefined as any,
    tradingDate: '2026-09-21',
    timestamp: new Date(),
    symbol,
    companyName: symbol,
    ltp: 100 + pct,
    open: 100,
    high: 100 + pct,
    low: 100,
    previousClose: 100,
    dayChange: pct,
    dayChangePercent: pct,
    volume,
    averagePrice: 100 + pct / 2,
    bestBid: 99.9,
    bestAsk: 100.1,
    source: 'mock',
    isStale: false,
    createdAt: new Date(),
  } as MarketSnapshotDoc;
}

describe('RankingService', () => {
  it('ranks stocks by intraday percent change descending', () => {
    const svc = new RankingService(5);
    const ranked = svc.rank([
      makeSnapshot('A', 3),
      makeSnapshot('B', 5),
      makeSnapshot('C', 1),
    ]);
    expect(ranked.map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
    expect(ranked[0].rank).toBe(1);
  });

  it('detects a new Top-N entrant', () => {
    const svc = new RankingService(5);

    // First cycle initializes previousTopN (no entrants emitted).
    const r0 = svc.detectTopNChanges(
      svc.rank([makeSnapshot('A', 5), makeSnapshot('B', 4), makeSnapshot('C', 3), makeSnapshot('D', 2), makeSnapshot('E', 1)]),
    );
    expect(r0.newEntrants).toEqual([]);

    // Second cycle: F climbs into Top N (pct 6), ranking F,A,B,D,E -> F is new entrant.
    const r1 = svc.detectTopNChanges(
      svc.rank([makeSnapshot('A', 5), makeSnapshot('B', 4), makeSnapshot('F', 6), makeSnapshot('D', 2), makeSnapshot('E', 1)]),
    );
    expect(r1.newEntrants.map((n) => n.symbol)).toEqual(['F']);
    expect(r1.currentTopN).toEqual(['F', 'A', 'B', 'D', 'E']);
  });

  it('does NOT fire when previous rank 5 -> current rank 4 (already in Top N)', () => {
    const svc = new RankingService(5);
    // initialize
    svc.detectTopNChanges(svc.rank([makeSnapshot('A', 5), makeSnapshot('B', 4), makeSnapshot('C', 3), makeSnapshot('D', 2), makeSnapshot('E', 1)]));
    // E was rank 5; now E moves to rank 4 but remains in top 5 -> no new entrant
    const r = svc.detectTopNChanges(
      svc.rank([makeSnapshot('A', 5), makeSnapshot('B', 4), makeSnapshot('C', 3), makeSnapshot('E', 2.5), makeSnapshot('D', 2)]),
    );
    expect(r.newEntrants).toEqual([]);
  });

  it('fires when previous rank 6 -> current rank 5 (true Top-N entry)', () => {
    const svc = new RankingService(5);
    // initialize with A,B,C,D,E in top5 (X rank 6)
    svc.detectTopNChanges(
      svc.rank([makeSnapshot('A', 6), makeSnapshot('B', 5), makeSnapshot('C', 4), makeSnapshot('D', 3), makeSnapshot('E', 2), makeSnapshot('X', 1)]),
    );
    // X climbs to rank 5, pushing E out
    const r = svc.detectTopNChanges(
      svc.rank([makeSnapshot('A', 6), makeSnapshot('B', 5), makeSnapshot('C', 4), makeSnapshot('D', 3), makeSnapshot('X', 2.5), makeSnapshot('E', 2)]),
    );
    expect(r.newEntrants.map((n) => n.symbol)).toEqual(['X']);
    expect(r.exited).toEqual(['E']);
  });

  it('de-duplicates: stock staying in Top N for 20 snapshots yields one entry', () => {
    const svc = new RankingService(5);
    const ranked = (top: string[]) =>
      svc.rank(top.map((s, i) => makeSnapshot(s, (5 - i) * 10)));
    // initial
    svc.detectTopNChanges(ranked(['A', 'B', 'C', 'D', 'E']));
    // swap F in once
    const entering = ['A', 'B', 'F', 'D', 'E'].map((s, i) => {
      const p = (5 - i) * 10;
      return makeSnapshot(s, p);
    });
    const r1 = svc.detectTopNChanges(svc.rank(entering));
    expect(r1.newEntrants.map((n) => n.symbol)).toEqual(['F']);
    // 20 snapshots where F stays in top N
    let entrants: string[] = [];
    for (let i = 0; i < 20; i++) {
      const rc = svc.detectTopNChanges(
        svc.rank(['A', 'B', 'F', 'D', 'E'].map((s, j) => makeSnapshot(s, (5 - j) * 10 + i * 0.01))),
      );
      entrants = entrants.concat(rc.newEntrants.map((n) => n.symbol));
    }
    expect(entrants).toEqual([]);
  });
});
