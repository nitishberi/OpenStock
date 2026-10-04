import { Schema, model, models, type Document, type Model } from 'mongoose';

/** DSA-shaped decision report fields (adapted from daily_stock_analysis, MIT). */
export type AnalysisAction = 'buy' | 'watch' | 'sell';
export type AnalysisBias = 'bullish' | 'bearish' | 'neutral';

export interface AnalysisReportAttrs {
  userId?: string;
  symbol: string;
  asOf: Date;
  action: AnalysisAction;
  score: number;
  trend: string;
  summary: string;
  catalysts: string[];
  risks: string[];
  checklist: string[];
  bias: AnalysisBias;
  confidence: number;
  evidenceUrls: string[];
  strategyLenses?: string[];
  pricingSnapshotId?: string;
  marketReviewId?: string;
  rawModelText?: string;
}

export interface AnalysisReportDoc extends AnalysisReportAttrs, Document {}

const AnalysisReportSchema = new Schema<AnalysisReportDoc>(
  {
    userId: { type: String, index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true, index: true },
    asOf: { type: Date, required: true, default: Date.now },
    action: { type: String, required: true, enum: ['buy', 'watch', 'sell'] },
    score: { type: Number, required: true, min: 0, max: 100 },
    trend: { type: String, required: true },
    summary: { type: String, required: true },
    catalysts: [{ type: String }],
    risks: [{ type: String }],
    checklist: [{ type: String }],
    bias: { type: String, required: true, enum: ['bullish', 'bearish', 'neutral'] },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    evidenceUrls: [{ type: String }],
    strategyLenses: [{ type: String }],
    pricingSnapshotId: { type: String },
    marketReviewId: { type: String },
    rawModelText: { type: String },
  },
  { timestamps: true }
);

AnalysisReportSchema.index({ symbol: 1, asOf: -1 });
AnalysisReportSchema.index({ userId: 1, asOf: -1 });

export const AnalysisReport: Model<AnalysisReportDoc> =
  (models?.AnalysisReport as Model<AnalysisReportDoc>) ||
  model<AnalysisReportDoc>('AnalysisReport', AnalysisReportSchema);
