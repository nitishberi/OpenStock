import { Schema, model, models, type Document, type Model } from 'mongoose';
import type { FactorAttributionReportValues } from '@/lib/forecast/types';

export interface FactorAttributionDoc extends FactorAttributionReportValues, Document {
  updatedAt: Date;
}

const FactorAttributionSchema = new Schema<FactorAttributionDoc>(
  {
    evalRunId: { type: String, required: true, index: true },
    modelVersion: { type: String, required: true },
    createdAt: { type: String, required: true },
    factors: { type: Schema.Types.Mixed, required: true },
    channelSummary: { type: Schema.Types.Mixed, required: true },
    narrative: { type: String, default: '' },
  },
  { timestamps: true }
);

export const FactorAttribution: Model<FactorAttributionDoc> =
  (models?.FactorAttribution as Model<FactorAttributionDoc>) ||
  model<FactorAttributionDoc>('FactorAttribution', FactorAttributionSchema);
