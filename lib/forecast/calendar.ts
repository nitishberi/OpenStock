/** US equity trading-day helpers (weekday approximation; no holiday calendar in v1). */

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

/** Next US weekday after `from` (exclusive). */
export function nextTradingDay(from: Date): Date {
  const d = new Date(from.getTime());
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (!isWeekday(d));
  return d;
}

/** Add N trading days to an as-of date (asOf itself is day 0). */
export function addTradingDays(asOf: Date | string, n: number): Date {
  let d = typeof asOf === 'string' ? parseUtcDate(asOf) : new Date(asOf.getTime());
  for (let i = 0; i < n; i++) d = nextTradingDay(d);
  return d;
}

/** Previous weekday on or before `d`. */
export function previousTradingDayOnOrBefore(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  while (!isWeekday(out)) out.setUTCDate(out.getUTCDate() - 1);
  return out;
}

/** Last `count` trading days ending on or before `end` (inclusive). */
export function lastTradingDays(end: Date | string, count: number): string[] {
  let d = typeof end === 'string' ? parseUtcDate(end) : previousTradingDayOnOrBefore(end);
  if (!isWeekday(d)) d = previousTradingDayOnOrBefore(d);
  const out: string[] = [];
  while (out.length < count) {
    if (isWeekday(d)) out.push(toUtcDateString(d));
    d = new Date(d.getTime() - MS_DAY);
  }
  return out.reverse();
}

/** Align a bar timestamp (ms or s) to UTC date string. */
export function barDateString(t: number): string {
  const ms = t < 1e12 ? t * 1000 : t;
  return toUtcDateString(new Date(ms));
}
