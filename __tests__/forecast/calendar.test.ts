import { describe, expect, it } from 'vitest';
import {
  addTradingDays,
  easterSundayUtc,
  isTradingDay,
  isUsEquityHoliday,
  lastTradingDays,
  toUtcDateString,
  usEquityHolidays,
} from '@/lib/forecast/calendar';

describe('US equity holiday calendar', () => {
  it('marks known 2025 NYSE holidays', () => {
    const h = usEquityHolidays(2025);
    expect(h.has('2025-01-01')).toBe(true); // New Year's
    expect(h.has('2025-01-20')).toBe(true); // MLK
    expect(h.has('2025-02-17')).toBe(true); // Presidents'
    expect(h.has('2025-04-18')).toBe(true); // Good Friday
    expect(h.has('2025-05-26')).toBe(true); // Memorial
    expect(h.has('2025-06-19')).toBe(true); // Juneteenth
    expect(h.has('2025-07-04')).toBe(true); // Independence
    expect(h.has('2025-09-01')).toBe(true); // Labor
    expect(h.has('2025-11-27')).toBe(true); // Thanksgiving
    expect(h.has('2025-12-25')).toBe(true); // Christmas
  });

  it('observes Independence Day on Friday when Jul 4 is Saturday (2020)', () => {
    expect(isUsEquityHoliday('2020-07-03')).toBe(true);
    expect(isTradingDay('2020-07-03')).toBe(false);
  });

  it('skips holidays in lastTradingDays / addTradingDays (no lookahead)', () => {
    // Window ending Thanksgiving week 2025 — Thanksgiving must not appear
    const days = lastTradingDays('2025-11-28', 5);
    expect(days).not.toContain('2025-11-27');
    expect(days).toEqual(['2025-11-21', '2025-11-24', '2025-11-25', '2025-11-26', '2025-11-28']);

    // D1 after Wednesday before Thanksgiving → Friday (skip Thursday holiday)
    const d1 = toUtcDateString(addTradingDays('2025-11-26', 1));
    expect(d1).toBe('2025-11-28');
  });

  it('computes Easter Sunday for Good Friday anchor', () => {
    expect(toUtcDateString(easterSundayUtc(2024))).toBe('2024-03-31');
    expect(toUtcDateString(easterSundayUtc(2025))).toBe('2025-04-20');
    expect(isUsEquityHoliday('2024-03-29')).toBe(true); // Good Friday 2024
  });
});
