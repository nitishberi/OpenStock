/** Shared contracts for swing D1–D5 price forecasts. */

export type ForecastHorizon = 'D1' | 'D2' | 'D3' | 'D5';

export const FORECAST_HORIZONS: ForecastHorizon[] = ['D1', 'D2', 'D3', 'D5'];

export const HORIZON_DAYS: Record<ForecastHorizon, number> = {
  D1: 1,
  D2: 2,
  D3: 3,
  D5: 5,
};

export type MediaChannel = 'news' | 'social' | 'press' | 'insider';

export type PressEventType = 'earnings' | 'product' | 'guidance' | 'legal' | 'other' | 'none';

export type ForecastDirection = 'up' | 'down' | 'flat';

export type ForecastStatus = 'active' | 'resolved';

/** Named feature groups used in attribution + training. */
export type FeatureGroup = 'price' | 'news' | 'social' | 'press' | 'insider';

export interface MarketFeatures {
  ret1d: number;
  ret5d: number;
  ret21d: number;
  vol21d: number;
  atrPct: number;
  sma20Dist: number;
  sma50Dist: number;
  /** Absolute SPY 5d log-return (index momentum). */
  spyRet5d: number;
  /** Absolute SPY 10d log-return. */
  spyRet10d: number;
  spyRel5d: number;
  sectorRel5d: number;
  dollarVolume20d: number;
  highVolRegime: number;
}

/** Residual-σ confidence calibration persisted on trained weights. */
export interface ConfidenceCalib {
  /** Per-horizon train-fold residual σ of (y − μ) in log-return space. */
  residualSigma: Record<ForecastHorizon, number>;
}

export interface NewsFeatures {
  newsCount48h: number;
  newsSentiment: number;
  newsNovelty: number;
}

export interface SocialFeatures {
  socialSentiment: number;
  socialVolume: number;
  socialBullBearSkew: number;
  polymarketTilt: number;
}

export interface PressFeatures {
  pressCount7d: number;
  pressSentiment: number;
  pressEventType: PressEventType;
  pressEventScore: number;
  daysSinceLastPress: number;
}

export interface InsiderFeatures {
  /** Purchase value in last 7d, $ millions. */
  insiderBuyValue7d: number;
  insiderBuyCount7d: number;
  /** Distinct-insider / Ins-column cluster strength (0 = none). */
  insiderClusterBuy: number;
  /** 1 if CEO/CFO purchase in window. */
  insiderCeoCfoBuy: number;
  /** Buys minus sells over 30d, $ millions. */
  insiderNetValue30d: number;
  /** Days since last buy, capped 0–30 (30 = none / stale). */
  daysSinceLastInsiderBuy: number;
}

export interface FeatureSnapshotValues
  extends MarketFeatures,
    NewsFeatures,
    SocialFeatures,
    PressFeatures,
    InsiderFeatures {
  symbol: string;
  asOf: string; // ISO date (UTC calendar day of asOf close)
  sector: string;
}

export interface PriceForecastValues {
  symbol: string;
  asOf: string;
  horizon: ForecastHorizon;
  lastClose: number;
  yHat: number;
  lo80: number;
  hi80: number;
  direction: ForecastDirection;
  confidence: number;
  featureVectorId?: string;
  modelVersion: string;
  rationale: string;
  evidenceUrls: string[];
  status: ForecastStatus;
  actualClose?: number;
  absError?: number;
  pctError?: number;
  signedError?: number;
  directionHit?: boolean;
  inside80?: boolean;
}

export interface ModelWeightsPayload {
  version: string;
  createdAt: string;
  parentVersion?: string;
  /** Per-horizon blend of drift / mean-reversion / event terms. */
  blend: Record<
    ForecastHorizon,
    { drift: number; meanReversion: number; event: number; intercept: number }
  >;
  /** Linear coefficients on FeatureSnapshot numeric fields (log-return space). */
  coefficients: Record<ForecastHorizon, Record<string, number>>;
  /** Capped additive event tilt from news+social+press+insider (log-return units). */
  eventTiltCap: number;
  /** Press releases get a higher capped tilt than generic news. */
  pressTiltMultiplier: number;
  /** Insider cluster / CEO-CFO buys get a capped tilt (same clamp as press). */
  insiderTiltMultiplier: number;
  /** Band half-width = k * realizedVol * sqrt(horizonDays). */
  bandK: Record<ForecastHorizon, number>;
  /** Residual-σ confidence params from train fold (optional on older payloads). */
  confidenceCalib?: ConfidenceCalib;
  notes?: string;
}

export interface HorizonMetrics {
  n: number;
  mae: number;
  mape: number;
  rmse: number;
  directionHitRate: number;
  coverage80: number;
}

export interface StrategyTestSummary {
  modelVersion: string;
  asOfStart: string;
  asOfEnd: string;
  symbolCount: number;
  byHorizon: Record<ForecastHorizon, HorizonMetrics>;
  bySector?: Record<string, Partial<Record<ForecastHorizon, HorizonMetrics>>>;
}

export interface FactorScore {
  feature: string;
  group: FeatureGroup;
  spearmanSignedError: number;
  spearmanDirectionHit: number;
  ablationMapeDelta: number;
  helpful: boolean;
}

export interface FactorAttributionReportValues {
  evalRunId: string;
  modelVersion: string;
  createdAt: string;
  factors: FactorScore[];
  channelSummary: Record<FeatureGroup, { mapeDelta: number; directionLift: number }>;
  narrative: string;
}
