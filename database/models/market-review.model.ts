import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface IndexSnapshot {
  symbol: string;
  name: string;
  last: number;
  changePct: number;
}

export interface MarketReviewAttrs {
  asOf: Date;
  session: 'pre_open' | 'intraday' | 'post_close';
  indices: IndexSnapshot[];
  breadthProxy?: { advancing: number; declining: number; unchanged: number };
  sectorLeaders?: string[];
  sectorLaggards?: string[];
  summary?: string;
  notes?: string[];
}

export interface MarketReviewDoc extends MarketReviewAttrs, Document {}

const MarketReviewSchema = new Schema<MarketReviewDoc>(
  {
    asOf: { type: Date, required: true, default: Date.now, index: true },
    session: {
      type: String,
      required: true,
      enum: ['pre_open', 'intraday', 'post_close'],
    },
    indices: [
      {
        symbol: String,
        name: String,
        last: Number,
        changePct: Number,
      },
    ],
    breadthProxy: {
      advancing: Number,
      declining: Number,
      unchanged: Number,
    },
    sectorLeaders: [{ type: String }],
    sectorLaggards: [{ type: String }],
    summary: { type: String },
    notes: [{ type: String }],
  },
  { timestamps: true }
);

export const MarketReview: Model<MarketReviewDoc> =
  (models?.MarketReview as Model<MarketReviewDoc>) ||
  model<MarketReviewDoc>('MarketReview', MarketReviewSchema);
