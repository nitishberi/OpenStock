/** US equity trading-day helpers with NYSE holiday skip (no lookahead — rules are fixed). */

const MS_DAY = 86_400_000;

export function toUtcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseUtcDate(iso: string): Date {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

/** Nth weekday in a UTC month (n≥1; weekday 0=Sun … 6=Sat). */
function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, monthIndex, 1 + offset + (n - 1) * 7));
}

/** Last weekday in a UTC month. */
function lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, monthIndex, last.getUTCDate() - offset));
}

/** Western Easter Sunday (Anonymous Gregorian algorithm), UTC date. */
export function easterSundayUtc(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Observed date for a fixed calendar holiday: Sat → Friday before, Sun → Monday after.
 * (NYSE practice for New Year's, Juneteenth, Independence Day, Christmas.)
 */
function observedFixed(year: number, monthIndex: number, day: number): Date {
  const d = new Date(Date.UTC(year, monthIndex, day));
  const wd = d.getUTCDay();
  if (wd === 6) return new Date(Date.UTC(year, monthIndex, day - 1));
  if (wd === 0) return new Date(Date.UTC(year, monthIndex, day + 1));
  return d;
}

/** NYSE full-day holidays for a calendar year (UTC date strings). */
export function usEquityHolidays(year: number): Set<string> {
  const clean = new Set<string>();
  clean.add(toUtcDateString(observedFixed(year, 0, 1))); // New Year's Day
  clean.add(toUtcDateString(nthWeekdayOfMonth(year, 0, 1, 3))); // MLK Day
  clean.add(toUtcDateString(nthWeekdayOfMonth(year, 1, 1, 3))); // Presidents' Day
  clean.add(toUtcDateString(new Date(easterSundayUtc(year).getTime() - 2 * MS_DAY))); // Good Friday
  clean.add(toUtcDateString(lastWeekdayOfMonth(year, 4, 1))); // Memorial Day
  if (year >= 2022) clean.add(toUtcDateString(observedFixed(year, 5, 19))); // Juneteenth
  clean.add(toUtcDateString(observedFixed(year, 6, 4))); // Independence Day
  clean.add(toUtcDateString(nthWeekdayOfMonth(year, 8, 1, 1))); // Labor Day
  clean.add(toUtcDateString(nthWeekdayOfMonth(year, 10, 4, 4))); // Thanksgiving
  clean.add(toUtcDateString(observedFixed(year, 11, 25))); // Christmas
  // When Jan 1 is Saturday, NYSE observes the prior Friday (Dec 31 of previous year).
  if (new Date(Date.UTC(year, 0, 1)).getUTCDay() === 6) {
    clean.add(toUtcDateString(new Date(Date.UTC(year - 1, 11, 31))));
  }
  return clean;
}

const holidayCache = new Map<number, Set<string>>();

function holidaysForYear(year: number): Set<string> {
  let set = holidayCache.get(year);
  if (!set) {
    set = usEquityHolidays(year);
    holidayCache.set(year, set);
  }
  return set;
}

export function isUsEquityHoliday(d: Date | string): boolean {
  const date = typeof d === 'string' ? parseUtcDate(d) : d;
  const iso = typeof d === 'string' ? d.slice(0, 10) : toUtcDateString(date);
  const y = date.getUTCFullYear();
  // Dec 31 observed New Year's lives in the *next* year's holiday set.
  return holidaysForYear(y).has(iso) || holidaysForYear(y + 1).has(iso);
}

/** True when the UTC calendar day is a US equity regular session (weekday, not holiday). */
export function isTradingDay(d: Date | string): boolean {
  const date = typeof d === 'string' ? parseUtcDate(d) : d;
  return isWeekday(date) && !isUsEquityHoliday(date);
}

/** Next US trading day after `from` (exclusive). */
export function nextTradingDay(from: Date): Date {
  const d = new Date(from.getTime());
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (!isTradingDay(d));
  return d;
}

/** Add N trading days to an as-of date (asOf itself is day 0). */
export function addTradingDays(asOf: Date | string, n: number): Date {
  let d = typeof asOf === 'string' ? parseUtcDate(asOf) : new Date(asOf.getTime());
  for (let i = 0; i < n; i++) d = nextTradingDay(d);
  return d;
}

/** Previous trading day on or before `d`. */
export function previousTradingDayOnOrBefore(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  while (!isTradingDay(out)) out.setUTCDate(out.getUTCDate() - 1);
  return out;
}

/** Last `count` trading days ending on or before `end` (inclusive). */
export function lastTradingDays(end: Date | string, count: number): string[] {
  let d = typeof end === 'string' ? parseUtcDate(end) : previousTradingDayOnOrBefore(end);
  if (!isTradingDay(d)) d = previousTradingDayOnOrBefore(d);
  const out: string[] = [];
  while (out.length < count) {
    if (isTradingDay(d)) out.push(toUtcDateString(d));
    d = new Date(d.getTime() - MS_DAY);
  }
  return out.reverse();
}

/** Align a bar timestamp (ms or s) to UTC date string. */
export function barDateString(t: number): string {
  const ms = t < 1e12 ? t * 1000 : t;
  return toUtcDateString(new Date(ms));
}
