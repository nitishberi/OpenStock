import type { ForecastHorizon, ModelWeightsPayload } from './types';
import { FORECAST_HORIZONS } from './types';

/** Hand-set priors for swing-baseline-v1. */
export function createSwingBaselineV1(): ModelWeightsPayload {
  const blendOne = { drift: 0.35, meanReversion: 0.35, event: 0.3, intercept: 0 };
  const blend: ModelWeightsPayload['blend'] = {
    D1: { ...blendOne, drift: 0.3, meanReversion: 0.4, event: 0.3 },
    D2: { ...blendOne },
    D3: { ...blendOne, drift: 0.4, meanReversion: 0.3, event: 0.3 },
    D5: { ...blendOne, drift: 0.45, meanReversion: 0.25, event: 0.3 },
  };

  const baseCoef: Record<string, number> = {
    ret1d: 0.08,
    ret5d: 0.12,
    ret21d: 0.05,
    vol21d: -0.02,
    atrPct: -0.01,
    sma20Dist: -0.15,
    sma50Dist: -0.08,
    spyRel5d: 0.1,
    sectorRel5d: 0.08,
    dollarVolume20d: 0,
    highVolRegime: -0.01,
    newsCount48h: 0.002,
    newsSentiment: 0.04,
    newsNovelty: 0.01,
    socialSentiment: 0.03,
    socialVolume: 0.005,
    socialBullBearSkew: 0.02,
    polymarketTilt: 0.015,
    pressCount7d: 0.004,
    pressSentiment: 0.05,
    pressEventScore: 0.03,
    // Feature is days capped at 30; tiny coef keeps empty-press state near-neutral
    daysSinceLastPress: -0.0002,
    insiderBuyValue7d: 0.02,
    insiderBuyCount7d: 0.003,
    insiderClusterBuy: 0.025,
    insiderCeoCfoBuy: 0.03,
    insiderNetValue30d: 0.01,
    daysSinceLastInsiderBuy: -0.0002,
  };

  const coefficients = {} as ModelWeightsPayload['coefficients'];
  for (const h of FORECAST_HORIZONS) {
    coefficients[h] = { ...baseCoef };
    // Longer horizons lean more on slower features
    if (h === 'D5') {
      coefficients[h].ret21d = 0.1;
      coefficients[h].ret1d = 0.02;
    }
  }

  return {
    version: 'swing-baseline-v1',
    createdAt: new Date().toISOString(),
    blend,
    coefficients,
    eventTiltCap: 0.02, // 2% log-return cap from events
    pressTiltMultiplier: 1.5, // press gets higher capped tilt than generic news
    insiderTiltMultiplier: 1.25, // cluster / CEO-CFO buys; same clamp as press
    bandK: { D1: 1.28, D2: 1.28, D3: 1.28, D5: 1.28 },
    notes: 'Hand-set priors; first strategy test + train produces v2.',
  };
}

export const FEATURE_KEYS = [
  'ret1d',
  'ret5d',
  'ret21d',
  'vol21d',
  'atrPct',
  'sma20Dist',
  'sma50Dist',
  'spyRel5d',
  'sectorRel5d',
  'dollarVolume20d',
  'highVolRegime',
  'newsCount48h',
  'newsSentiment',
  'newsNovelty',
  'socialSentiment',
  'socialVolume',
  'socialBullBearSkew',
  'polymarketTilt',
  'pressCount7d',
  'pressSentiment',
  'pressEventScore',
  'daysSinceLastPress',
  'insiderBuyValue7d',
  'insiderBuyCount7d',
  'insiderClusterBuy',
  'insiderCeoCfoBuy',
  'insiderNetValue30d',
  'daysSinceLastInsiderBuy',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_GROUP_OF: Record<FeatureKey, 'price' | 'news' | 'social' | 'press' | 'insider'> = {
  ret1d: 'price',
  ret5d: 'price',
  ret21d: 'price',
  vol21d: 'price',
  atrPct: 'price',
  sma20Dist: 'price',
  sma50Dist: 'price',
  spyRel5d: 'price',
  sectorRel5d: 'price',
  dollarVolume20d: 'price',
  highVolRegime: 'price',
  newsCount48h: 'news',
  newsSentiment: 'news',
  newsNovelty: 'news',
  socialSentiment: 'social',
  socialVolume: 'social',
  socialBullBearSkew: 'social',
  polymarketTilt: 'social',
  pressCount7d: 'press',
  pressSentiment: 'press',
  pressEventScore: 'press',
  daysSinceLastPress: 'press',
  insiderBuyValue7d: 'insider',
  insiderBuyCount7d: 'insider',
  insiderClusterBuy: 'insider',
  insiderCeoCfoBuy: 'insider',
  insiderNetValue30d: 'insider',
  daysSinceLastInsiderBuy: 'insider',
};

/** Ensure older persisted payloads gain insider tilt multiplier + coef keys. */
export function normalizeWeights(w: ModelWeightsPayload): ModelWeightsPayload {
  const base = createSwingBaselineV1();
  const coefficients = { ...w.coefficients };
  for (const h of FORECAST_HORIZONS) {
    coefficients[h] = { ...base.coefficients[h], ...(w.coefficients?.[h] || {}) };
  }
  return {
    ...base,
    ...w,
    coefficients,
    insiderTiltMultiplier: w.insiderTiltMultiplier ?? base.insiderTiltMultiplier,
    pressTiltMultiplier: w.pressTiltMultiplier ?? base.pressTiltMultiplier,
    eventTiltCap: w.eventTiltCap ?? base.eventTiltCap,
  };
}

export function defaultWeightsForVersion(version: string): ModelWeightsPayload {
  if (version === 'swing-baseline-v1' || version.startsWith('swing-baseline-v1')) {
    return createSwingBaselineV1();
  }
  const base = createSwingBaselineV1();
  return normalizeWeights({ ...base, version });
}

export function scaleHorizonDays(h: ForecastHorizon): number {
  return h === 'D1' ? 1 : h === 'D2' ? 2 : h === 'D3' ? 3 : 5;
}
