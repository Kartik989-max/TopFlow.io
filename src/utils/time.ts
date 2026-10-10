import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { isNseHoliday } from '../config/nseHolidays.js';

const ZONE = env.MARKET_TIMEZONE;

export const istZone = ZONE;

export function nowIST(): DateTime {
  return DateTime.now().setZone(ZONE);
}

export function parseMarketTime(hhmm: string, at?: DateTime): DateTime {
  const base = at ?? nowIST();
  const [hh, mm] = hhmm.split(':').map(Number);
  return base.set({ hour: hh, minute: mm, second: 0, millisecond: 0 });
}

export function todayOpen(at = nowIST()): DateTime {
  return parseMarketTime(env.MARKET_OPEN, at);
}

export function todayClose(at = nowIST()): DateTime {
  return parseMarketTime(env.MARKET_CLOSE, at);
}

export function isWeekend(dt: DateTime): boolean {
  const d = dt.weekday; // 1 Mon .. 7 Sun
  return d === 6 || d === 7;
}

export function isTradingDay(dt: DateTime): boolean {
  if (env.MARKET_FORCE_OPEN) return true;
  if (isWeekend(dt)) return false;
  if (isNseHoliday({ year: dt.year, month: dt.month, day: dt.day })) return false;
  return true;
}

// Demo/test anchor: when MARKET_FORCE_OPEN is set, the (bounded) open window
// starts at the first call during a session. Reset between real sessions.
let forcedOpenStart: DateTime | null = null;
export function resetForcedOpen(): void {
  forcedOpenStart = null;
}
export function setForcedOpenStart(dt: DateTime): void {
  forcedOpenStart = dt;
}


export function isMarketOpen(at = nowIST()): boolean {
  if (env.MARKET_FORCE_OPEN) {
    const w = currentMarketWindow(at);
    if (!w) return false;
    return at.toMillis() >= w.open.getTime() && at.toMillis() < w.close.getTime();
  }
  if (!isTradingDay(at)) return false;
  const open = todayOpen(at);
  const close = todayClose(at);
  return at >= open && at < close;
}

export function isMarketClosed(at = nowIST()): boolean {
  return !isMarketOpen(at);
}

// Guaranteed non-null ISO date string (luxon's toISODate can return null).
export function isoDate(at: DateTime = nowIST()): string {
  return at.toISODate() ?? '';
}

// The trading date (YYYY-MM-DD) active for the given instant. If we are after
// close but before the next open, this still returns the just-closed day so
// EOD flows keep operating on the same tradingDate until the next session opens.
export function currentTradingDate(at = nowIST()): string | null {
  if (env.MARKET_FORCE_OPEN) return isoDate(at);
  if (!isTradingDay(at)) {
    // find most recent trading day
    let d = at;
    let guard = 0;
    while (!isTradingDay(d) && guard++ < 10) d = d.minus({ days: 1 }).startOf('day').set({ hour: 12 });
    return isTradingDay(d) ? d.toISODate() : null;
  }
  return at.toISODate();
}

export function nextMarketOpen(at = nowIST()): DateTime | null {
  if (env.MARKET_FORCE_OPEN) {
    if (!forcedOpenStart) {
      forcedOpenStart = at;
    }
    return forcedOpenStart;
  }
  if (at.weekday === 6) return todayOpen(at.plus({ days: 2 })); // Sat -> Mon
  if (at.weekday === 7) return todayOpen(at.plus({ days: 1 })); // Sun -> Mon
  const open = todayOpen(at);
  if (at < open) return open;
  return todayOpen(at.plus({ days: 1 }));
}

export interface MarketWindow {
  tradingDate: string;
  open: Date;
  close: Date;
  isToday: boolean;
  untilTransitionMs: number;
}

export function currentMarketWindow(at = nowIST()): MarketWindow | null {
  if (env.MARKET_FORCE_OPEN) {
    if (!forcedOpenStart) forcedOpenStart = at;
    const open = forcedOpenStart;
    const close = open.plus({ minutes: env.FORCE_OPEN_MINUTES });
    return {
      tradingDate: isoDate(at),
      open: open.toJSDate(),
      close: close.toJSDate(),
      isToday: true,
      untilTransitionMs: close.toMillis() - at.toMillis(),
    };
  }
  if (!isTradingDay(at)) return null;
  const open = todayOpen(at);
  const close = todayClose(at);
  const until = at < open ? open.toMillis() - at.toMillis() : close.toMillis() - at.toMillis();
  return {
    tradingDate: isoDate(at),
    open: open.toJSDate(),
    close: close.toJSDate(),
    isToday: true,
    untilTransitionMs: Math.max(0, until),
  };
}

export function toIST(date: Date): DateTime {
  return DateTime.fromJSDate(date).setZone(ZONE);
}

export function formatTimestamp(dt: DateTime | Date): string {
  const d = dt instanceof Date ? toIST(dt) : dt.setZone(ZONE);
  return d.toISO({ includeOffset: false, suppressSeconds: false }) ?? '';
}

export function nextAlignedTimestamp(intervalMs: number, now = Date.now()): number {
  return Math.ceil(now / intervalMs) * intervalMs;
}
