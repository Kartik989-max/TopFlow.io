// NSE Capital Market (equity) trading holidays for the calendar year 2026,
// published by the exchange. Source: NSE/BSE circulars.
//
// Only the Equity Segment list is authoritative for this project (we monitor
// NIFTY 50 cash instruments). Holidays falling on Sat/Sun are already excluded
// from the runtime set since weekends are skipped separately.
//
// The exchange may issue additional closures via circular; the runtime treats
// this list as the base and allows an env override (MARKET_HOLIDAYS) of
// additional YYYY-MM-DD entries.

export const NSE_HOLIDAYS_2026: readonly string[] = [
  '2026-01-15', // MCGM Election day
  '2026-01-26', // Republic Day
  '2026-03-03', // Holi
  '2026-03-26', // Shri Ram Navami
  '2026-03-31', // Shri Mahavir Jayanti
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Baba Saheb Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-28', // Bakri Id
  '2026-06-26', // Muharram
  '2026-09-14', // Ganesh Chaturthi
  '2026-10-02', // Mahatma Gandhi Jayanti
  '2026-10-20', // Dussehra
  '2026-11-10', // Diwali Balipratipada
  '2026-11-24', // Prakash Gurpurb Sri Guru Nanak Dev
  '2026-12-25', // Christmas
];

// 2025 list (for seeding prior-year history / relative volume lookbacks).
export const NSE_HOLIDAYS_2025: readonly string[] = [
  '2025-01-26', // Republic Day
  '2025-03-14', // Holi
  '2025-03-31', // Shri Ram Navami
  '2025-04-14', // Ambedkar Jayanti / Shri Mahavir Jayanti (observed)
  '2025-04-18', // Good Friday
  '2025-05-01', // Maharashtra Day / Labour Day
  '2025-08-15', // Independence Day (falls on Sat; no additional closure)
  '2025-10-02', // Gandhi Jayanti
  '2025-10-20', // Dussehra
  '2025-11-04', // Diwali Laxmi Pujan / Balipratipada
  '2025-11-24', // Guru Nanak Dev Jayanti
  '2025-12-25', // Christmas (falls on Thu)
];

const HOLIDAYS_BY_YEAR: Record<number, readonly string[]> = {
  2025: NSE_HOLIDAYS_2025,
  2026: NSE_HOLIDAYS_2026,
};

export function nseHolidaysForYear(year: number): readonly string[] {
  return HOLIDAYS_BY_YEAR[year] ?? [];
}

export function isNseHoliday(date: { year: number; month: number; day: number }): boolean {
  const pad = (n: number) => String(n).padStart(2, '0');
  const key = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
  const list = nseHolidaysForYear(date.year);
  return list.includes(key);
}