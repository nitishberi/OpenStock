import { Schema, model, models, type Document, type Model } from 'mongoose';
import type { ForecastDirection, ForecastHorizon, ForecastStatus } from '@/lib/forecast/types';

export interface PriceForecastDoc extends Document {
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
  evalRunId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PriceForecastSchema = new Schema<PriceForecastDoc>(
  {
    symbol: { type: String, required: true, uppercase: true, index: true },
    asOf: { type: String, required: true, index: true },
    horizon: { type: String, required: true, enum: ['D1', 'D2', 'D3', 'D5'] },
    lastClose: { type: Number, required: true },
    yHat: { type: Number, required: true },
    lo80: { type: Number, required: true },
    hi80: { type: Number, required: true },
    direction: { type: String, required: true, enum: ['up', 'down', 'flat'] },
    confidence: { type: Number, required: true },
    featureVectorId: { type: String },
    modelVersion: { type: String, required: true, index: true },
    rationale: { type: String, default: '' },
    evidenceUrls: [{ type: String }],
    status: { type: String, required: true, enum: ['active', 'resolved'], default: 'active', index: true },
    actualClose: Number,
    absError: Number,
    pctError: Number,
    signedError: Number,
    directionHit: Boolean,
    inside80: Boolean,
    evalRunId: { type: String, index: true },
  },
  { timestamps: true }
);

PriceForecastSchema.index({ symbol: 1, asOf: 1, horizon: 1, modelVersion: 1 });

export const PriceForecast: Model<PriceForecastDoc> =
  (models?.PriceForecast as Model<PriceForecastDoc>) ||
  model<PriceForecastDoc>('PriceForecast', PriceForecastSchema);
