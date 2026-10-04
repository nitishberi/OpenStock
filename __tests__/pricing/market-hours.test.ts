import { describe, expect, it } from 'vitest';
import { isUsEquitySessionOpen, sessionLabel } from '@/lib/trading/market-hours';

describe('market hours', () => {
  it('closed on weekend', () => {
    // Sunday UTC that is still Sunday in ET
    const sunday = new Date('2026-03-08T15:00:00Z');
    expect(isUsEquitySessionOpen(sunday)).toBe(false);
  });

  it('open mid RTH', () => {
    // Wednesday 15:00 UTC ≈ 10:00 or 11:00 ET depending on DST — March 2026 EDT so 11:00
    const wed = new Date('2026-03-11T15:00:00Z');
    expect(isUsEquitySessionOpen(wed)).toBe(true);
    expect(sessionLabel(wed)).toBe('intraday');
  });

  it('pre_open early morning ET', () => {
    const early = new Date('2026-03-11T12:00:00Z'); // 08:00 EDT
    expect(isUsEquitySessionOpen(early)).toBe(false);
    expect(sessionLabel(early)).toBe('pre_open');
  });
});
