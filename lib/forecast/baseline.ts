/**
 * Trainable baseline forecaster: linear/blend model + vol-scaled 80% bands + capped event tilt.
 * Gemini explain/clamp is applied separately (gemini-clamp.ts).
 */

import type {
  FeatureSnapshotValues,
  ForecastDirection,
  ForecastHorizon,
  ModelWeightsPayload,
  PriceForecastValues,
} from './types';
import { FORECAST_HORIZONS } from './types';
import { FEATURE_KEYS, scaleHorizonDays } from './weights';
import { insiderRawEventTilt } from './insider';

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round2 = (n: number) => Math.round(n * 100) / 100;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function featureNumericVector(f: FeatureSnapshotValues): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of FEATURE_KEYS) {
    const v = f[k as keyof FeatureSnapshotValues];
    out[k] = typeof v === 'number' ? v : 0;
  }
  return out;
}

/** Predicted log-return for one horizon from frozen features + weights. */
export function predictLogReturn(
  features: FeatureSnapshotValues,
  weights: ModelWeightsPayload,
  horizon: ForecastHorizon
): { mu: number; eventTilt: number; components: { drift: number; meanReversion: number; event: number; linear: number } } {
  const coef = weights.coefficients[horizon];
  const blend = weights.blend[horizon];
  const vec = featureNumericVector(features);

  let linear = blend.intercept;
  for (const [k, c] of Object.entries(coef)) {
    linear += (vec[k] ?? 0) * c;
  }

  // Drift: short momentum
  const drift = features.ret5d * 0.6 + features.ret1d * 0.4;
  // Mean reversion: pull toward SMA20
  const meanReversion = -features.sma20Dist * 0.5;
  // Event: news + social + press + insider (press/insider amplified; shared cap)
  const newsTilt = features.newsSentiment * 0.4 + Math.sign(features.newsSentiment) * Math.min(0.3, features.newsCount48h / 20);
  const socialTilt = features.socialSentiment * 0.35 + features.socialBullBearSkew * 0.15 + features.polymarketTilt * 0.15;
  const pressTilt =
    (features.pressSentiment * 0.45 + features.pressEventScore * 0.25) * weights.pressTiltMultiplier;
  const insiderTilt = insiderRawEventTilt(features, {
    multiplier: weights.insiderTiltMultiplier ?? 1.25,
  });
  const rawEvent = newsTilt + socialTilt + pressTilt + insiderTilt;
  const eventTilt = clamp(rawEvent * 0.01, -weights.eventTiltCap, weights.eventTiltCap);

  const blended =
    blend.drift * drift +
    blend.meanReversion * meanReversion +
    blend.event * eventTilt * 10 + // scale event into same order as log-returns
    (1 - (blend.drift + blend.meanReversion + blend.event)) * linear;

  // Mix linear ridge term with classical blend
  const mu = 0.55 * linear + 0.45 * (blend.drift * drift + blend.meanReversion * meanReversion) + eventTilt;

  return {
    mu,
    eventTilt,
    components: { drift, meanReversion, event: eventTilt, linear: blended },
  };
}

export function directionFromReturn(mu: number, flatEps = 0.0015): ForecastDirection {
  if (mu > flatEps) return 'up';
  if (mu < -flatEps) return 'down';
  return 'flat';
}

export function confidenceFrom(features: FeatureSnapshotValues, bandWidthPct: number): number {
  const mediaBoost =
    Math.min(0.15, features.newsCount48h / 40) +
    Math.min(0.1, Math.abs(features.socialSentiment) * 0.1) +
    Math.min(0.1, features.pressCount7d / 20) +
    Math.min(0.1, features.insiderBuyCount7d / 10 + features.insiderClusterBuy * 0.02);
  const volPenalty = Math.min(0.25, features.vol21d);
  return clamp(0.45 + mediaBoost - volPenalty - bandWidthPct * 0.5, 0.15, 0.92);
}

export function forecastHorizons(input: {
  features: FeatureSnapshotValues;
  lastClose: number;
  weights: ModelWeightsPayload;
  evidenceUrls?: string[];
  rationale?: string;
}): PriceForecastValues[] {
  const { features, lastClose, weights } = input;
  const out: PriceForecastValues[] = [];

  for (const horizon of FORECAST_HORIZONS) {
    const { mu, eventTilt } = predictLogReturn(features, weights, horizon);
    const days = scaleHorizonDays(horizon);
    const dailyVol = Math.max(0.005, features.vol21d / Math.sqrt(252));
    const k = weights.bandK[horizon];
    const half = k * dailyVol * Math.sqrt(days);
    const yHat = lastClose * Math.exp(mu);
    const lo80 = lastClose * Math.exp(mu - half);
    const hi80 = lastClose * Math.exp(mu + half);
    const bandWidthPct = (hi80 - lo80) / lastClose;

    out.push({
      symbol: features.symbol,
      asOf: features.asOf,
      horizon,
      lastClose: round2(lastClose),
      yHat: round2(yHat),
      lo80: round2(lo80),
      hi80: round2(hi80),
      direction: directionFromReturn(mu),
      confidence: round4(confidenceFrom(features, bandWidthPct)),
      modelVersion: weights.version,
      rationale:
        input.rationale ||
        `Baseline ${weights.version}: μ=${round4(mu)}, eventTilt=${round4(eventTilt)}, vol=${round4(features.vol21d)}.`,
      evidenceUrls: input.evidenceUrls || [],
      status: 'active',
    });
  }
  return out;
}

/** Clamp a Gemini-nudged yHat into [lo80, hi80]. */
export function clampYHatToBand(yHat: number, lo80: number, hi80: number): number {
  return round2(clamp(yHat, lo80, hi80));
}
