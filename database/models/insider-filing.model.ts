import { Schema, model, models, type Document, type Model } from 'mongoose';

export type InsiderSourceList = 'cluster-buys' | 'purchases-25k' | 'ticker';

export interface InsiderFilingFlags {
  amended?: boolean;
  multiDay?: boolean;
  cluster?: boolean;
  ceoCfo?: boolean;
}

export interface InsiderFilingAttrs {
  filingDate: string; // YYYY-MM-DD
  tradeDate: string;
  ticker: string;
  companyName?: string;
  insiderName: string;
  title?: string;
  tradeType: string; // P / S / A / F …
  price?: number;
  qty?: number;
  owned?: number;
  deltaOwnPct?: number;
  valueUsd?: number;
  flags?: InsiderFilingFlags;
  /** Cluster list “Ins” column when present. */
  insCount?: number;
  sourceUrl: string;
  sourceList: InsiderSourceList;
  ingestedAt: Date;
}

export interface InsiderFilingDoc extends InsiderFilingAttrs, Document {}

const InsiderFilingSchema = new Schema<InsiderFilingDoc>(
  {
    filingDate: { type: String, required: true, index: true },
    tradeDate: { type: String, required: true, index: true },
    ticker: { type: String, required: true, uppercase: true, trim: true, index: true },
    companyName: { type: String, trim: true },
    insiderName: { type: String, required: true, trim: true, default: '' },
    title: { type: String, trim: true },
    tradeType: { type: String, required: true, trim: true, uppercase: true },
    price: { type: Number },
    qty: { type: Number },
    owned: { type: Number },
    deltaOwnPct: { type: Number },
    valueUsd: { type: Number },
    flags: {
      amended: { type: Boolean, default: false },
      multiDay: { type: Boolean, default: false },
      cluster: { type: Boolean, default: false },
      ceoCfo: { type: Boolean, default: false },
    },
    insCount: { type: Number },
    sourceUrl: { type: String, required: true, trim: true },
    sourceList: {
      type: String,
      required: true,
      enum: ['cluster-buys', 'purchases-25k', 'ticker'],
      index: true,
    },
    ingestedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

/** Upsert dedupe key from the OpenInsider plan. */
InsiderFilingSchema.index(
  {
    ticker: 1,
    filingDate: 1,
    insiderName: 1,
    tradeDate: 1,
    qty: 1,
    valueUsd: 1,
  },
  { unique: true }
);
InsiderFilingSchema.index({ ticker: 1, filingDate: -1 });
InsiderFilingSchema.index({ ingestedAt: -1 });

export const InsiderFiling: Model<InsiderFilingDoc> =
  (models?.InsiderFiling as Model<InsiderFilingDoc>) ||
  model<InsiderFilingDoc>('InsiderFiling', InsiderFilingSchema);
