import { describe, expect, it } from 'vitest';

/** Pure helper mirrored from forecasts resolve — keep mulberry sample stable. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(symbols: string[], count: number, seed: number) {
  const rng = mulberry32(seed);
  const arr = [...symbols];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

describe('forecast symbol sampling', () => {
  it('is deterministic for a seed', () => {
    const u = Array.from({ length: 100 }, (_, i) => `S${i}`);
    expect(sample(u, 10, 42)).toEqual(sample(u, 10, 42));
    expect(sample(u, 10, 42)).not.toEqual(sample(u, 10, 43));
  });
});
