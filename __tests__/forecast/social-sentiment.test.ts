import { describe, expect, it } from 'vitest';
import { bullBearSkew, lexiconPolarity, scorePolarity } from '@/lib/forecast/sentiment';
import {
  isLoginWalledUrl,
  isPublicSocialUrl,
} from '@/lib/forecast/social-discover';
import { featuresFromStoredMedia } from '@/lib/forecast/media';

describe('local VADER / lexicon polarity', () => {
  it('scores clearly positive and negative prose', () => {
    expect(scorePolarity('This is amazing great wonderful')).toBeGreaterThan(0.5);
    expect(scorePolarity('terrible awful bad loss')).toBeLessThan(-0.5);
  });

  it('uses finance lexicon when VADER is near-neutral', () => {
    expect(lexiconPolarity('AAPL to the moon bullish breakout')).toBeGreaterThan(0);
    expect(scorePolarity('AAPL to the moon bullish breakout')).toBeGreaterThan(0);
  });

  it('computes bull/bear skew', () => {
    expect(bullBearSkew([0.4, 0.3, -0.2])).toBeCloseTo((2 - 1) / 3);
    expect(bullBearSkew([])).toBe(0);
  });
});

describe('social public URL filter', () => {
  it('allows public discussion hosts', () => {
    expect(isPublicSocialUrl('https://www.reddit.com/r/stocks/comments/abc/aapl/')).toBe(true);
    expect(isPublicSocialUrl('https://stocktwits.com/symbol/AAPL')).toBe(true);
  });

  it('rejects login walls and X/Twitter', () => {
    expect(isLoginWalledUrl('https://x.com/someone/status/1')).toBe(true);
    expect(isPublicSocialUrl('https://twitter.com/someone/status/1')).toBe(false);
    expect(isPublicSocialUrl('https://reddit.com/login')).toBe(false);
  });
});

describe('featuresFromStoredMedia social channel', () => {
  it('fills socialSentiment / volume / skew from social docs', () => {
    const asOf = '2024-06-10';
    const { social } = featuresFromStoredMedia(
      [
        {
          channel: 'social',
          title: 'AAPL looks strong bullish rally',
          excerpt: 'great gains upgrade',
          url: 'https://www.reddit.com/r/stocks/comments/1',
          fetchedAt: '2024-06-09T12:00:00.000Z',
        },
        {
          channel: 'social',
          title: 'AAPL weak miss downgrade',
          excerpt: 'bearish decline',
          url: 'https://stocktwits.com/symbol/AAPL',
          fetchedAt: '2024-06-08T12:00:00.000Z',
        },
      ],
      asOf
    );
    expect(social.socialVolume).toBeGreaterThan(0);
    expect(Number.isFinite(social.socialSentiment)).toBe(true);
    expect(Number.isFinite(social.socialBullBearSkew)).toBe(true);
    expect(social.polymarketTilt).toBe(0);
  });
});
