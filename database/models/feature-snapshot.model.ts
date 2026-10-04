import { Schema, model, models, type Document, type Model } from 'mongoose';
import type { FeatureSnapshotValues, PressEventType } from '@/lib/forecast/types';

export interface FeatureSnapshotDoc extends FeatureSnapshotValues, Document {
  createdAt: Date;
  updatedAt: Date;
}

const FeatureSnapshotSchema = new Schema<FeatureSnapshotDoc>(
  {
    symbol: { type: String, required: true, uppercase: true, index: true },
    asOf: { type: String, required: true, index: true },
    sector: { type: String, required: true },
    ret1d: Number,
    ret5d: Number,
    ret21d: Number,
    vol21d: Number,
    atrPct: Number,
    sma20Dist: Number,
    sma50Dist: Number,
    spyRel5d: Number,
    sectorRel5d: Number,
    dollarVolume20d: Number,
    highVolRegime: Number,
    newsCount48h: Number,
    newsSentiment: Number,
    newsNovelty: Number,
    socialSentiment: Number,
    socialVolume: Number,
    socialBullBearSkew: Number,
    polymarketTilt: Number,
    pressCount7d: Number,
    pressSentiment: Number,
    pressEventType: {
      type: String,
      enum: ['earnings', 'product', 'guidance', 'legal', 'other', 'none'],
      default: 'none',
    },
    pressEventScore: Number,
    daysSinceLastPress: Number,
  },
  { timestamps: true }
);

FeatureSnapshotSchema.index({ symbol: 1, asOf: 1 }, { unique: true });

export const FeatureSnapshot: Model<FeatureSnapshotDoc> =
  (models?.FeatureSnapshot as Model<FeatureSnapshotDoc>) ||
  model<FeatureSnapshotDoc>('FeatureSnapshot', FeatureSnapshotSchema);

export type { PressEventType };
