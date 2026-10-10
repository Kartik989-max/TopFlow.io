import { DateTime } from 'luxon';
import { isTradingDay, isMarketOpen, currentTradingDate, isWeekend } from '../../src/utils/time.js';

describe('time/market hours', () => {
  it('does not treat weekends as trading days', () => {
    const sat = DateTime.fromISO('2026-09-19T10:00:00', { zone: 'Asia/Kolkata' });
    const sun = DateTime.fromISO('2026-09-20T10:00:00', { zone: 'Asia/Kolkata' });
    expect(isTradingDay(sat)).toBe(false);
    expect(isTradingDay(sun)).toBe(false);
  });

  it('detects weekends', () => {
    const mon = DateTime.fromISO('2026-09-21T10:00:00', { zone: 'Asia/Kolkata' });
    const sat = DateTime.fromISO('2026-09-19T10:00:00', { zone: 'Asia/Kolkata' });
    expect(isWeekend(sat)).toBe(true);
    expect(isWeekend(mon)).toBe(false);
  });

  it('market is closed on a non-trading day', () => {
    expect(isMarketOpen(DateTime.fromISO('2026-09-20T11:00:00', { zone: 'Asia/Kolkata' }))).toBe(false);
  });

  it('market is open during regular hours on a trading day', () => {
    const t = DateTime.fromISO('2026-09-21T11:00:00', { zone: 'Asia/Kolkata' });
    expect(isMarketOpen(t)).toBe(true);
    const before = DateTime.fromISO('2026-09-21T09:00:00', { zone: 'Asia/Kolkata' });
    expect(isMarketOpen(before)).toBe(false);
    const after = DateTime.fromISO('2026-09-21T15:31:00', { zone: 'Asia/Kolkata' });
    expect(isMarketOpen(after)).toBe(false);
  });

  it('currentTradingDate falls back to most recent trading day', () => {
    const sunday = DateTime.fromISO('2026-09-20T11:00:00', { zone: 'Asia/Kolkata' });
    const d = currentTradingDate(sunday);
    expect(d).not.toBeNull();
    expect(isTradingDay(DateTime.fromISO(d!, { zone: 'Asia/Kolkata' }))).toBe(true);
  });
});
