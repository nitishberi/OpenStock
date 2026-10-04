import { Schema, model, models, type Document, type Model } from 'mongoose';
import type { StrategyTestSummary } from '@/lib/forecast/types';

export interface EvalRunDoc extends Document {
  kind: 'strategy_test' | 'holdout';
  modelVersion: string;
  summary: StrategyTestSummary;
  holdoutAsOfs: string[];
  rowCount: number;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EvalRunSchema = new Schema<EvalRunDoc>(
  {
    kind: { type: String, enum: ['strategy_test', 'holdout'], required: true },
    modelVersion: { type: String, required: true, index: true },
    summary: { type: Schema.Types.Mixed, required: true },
    holdoutAsOfs: [{ type: String }],
    rowCount: { type: Number, default: 0 },
    status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
    error: String,
  },
  { timestamps: true }
);

export const EvalRun: Model<EvalRunDoc> =
  (models?.EvalRun as Model<EvalRunDoc>) || model<EvalRunDoc>('EvalRun', EvalRunSchema);
