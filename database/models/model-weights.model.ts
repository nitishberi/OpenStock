import { Schema, model, models, type Document, type Model } from 'mongoose';
import type { ModelWeightsPayload } from '@/lib/forecast/types';

export interface ModelWeightsDoc extends Document {
  version: string;
  payload: ModelWeightsPayload;
  active: boolean;
  promotedFrom?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ModelWeightsSchema = new Schema<ModelWeightsDoc>(
  {
    version: { type: String, required: true, unique: true },
    payload: { type: Schema.Types.Mixed, required: true },
    active: { type: Boolean, default: false, index: true },
    promotedFrom: { type: String },
  },
  { timestamps: true }
);

export const ModelWeights: Model<ModelWeightsDoc> =
  (models?.ModelWeights as Model<ModelWeightsDoc>) ||
  model<ModelWeightsDoc>('ModelWeights', ModelWeightsSchema);
