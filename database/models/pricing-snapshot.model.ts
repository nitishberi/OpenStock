import { Schema, model, models, type Document, type Model } from 'mongoose';

export type PricingRegime = 'trend_breakout' | 'mean_reversion' | 'neutral';

export interface PriceBand {
  low: number;
  mid: number;
  high: number;
}

export interface PricingSnapshotAttrs {
  symbol: string;
  asOf: Date;
  last: number;
  mid?: number;
  fairValueBand: PriceBand;
  entryZone: PriceBand;
  stop: number;
  targets: { t1: number; t2: number };
  expectedMove: number;
  spreadCost: number;
  maxSlippageBps: number;
  confidence: number;
  regime: PricingRegime;
  atr14?: number;
  vwap?: number;
  openingRange?: { high: number; low: number };
  relativeStrength?: { vsSpy: number; vsSector?: number };
  microstructure?: {
    spreadBps?: number;
    quoteAgeMs?: number;
    relativeVolume?: number;
    blockMarketOrders?: boolean;
  };
  eventPremium?: number;
  notes?: string[];
  inputsHash?: string;
}

export interface PricingSnapshotDoc extends PricingSnapshotAttrs, Document {}

const BandSchema = new Schema(
  {
    low: { type: Number, required: true },
    mid: { type: Number, required: true },
    high: { type: Number, required: true },
  },
  { _id: false }
);

const PricingSnapshotSchema = new Schema<PricingSnapshotDoc>(
  {
    symbol: { type: String, required: true, uppercase: true, trim: true, index: true },
    asOf: { type: Date, required: true, default: Date.now },
    last: { type: Number, required: true },
    mid: { type: Number },
    fairValueBand: { type: BandSchema, required: true },
    entryZone: { type: BandSchema, required: true },
    stop: { type: Number, required: true },
    targets: {
      t1: { type: Number, required: true },
      t2: { type: Number, required: true },
    },
    expectedMove: { type: Number, required: true },
    spreadCost: { type: Number, required: true },
    maxSlippageBps: { type: Number, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    regime: {
      type: String,
      required: true,
      enum: ['trend_breakout', 'mean_reversion', 'neutral'],
    },
    atr14: { type: Number },
    vwap: { type: Number },
    openingRange: {
      high: Number,
      low: Number,
    },
    relativeStrength: {
      vsSpy: Number,
      vsSector: Number,
    },
    microstructure: {
      spreadBps: Number,
      quoteAgeMs: Number,
      relativeVolume: Number,
      blockMarketOrders: Boolean,
    },
    eventPremium: { type: Number },
    notes: [{ type: String }],
    inputsHash: { type: String },
  },
  { timestamps: true }
);

PricingSnapshotSchema.index({ symbol: 1, asOf: -1 });

export const PricingSnapshot: Model<PricingSnapshotDoc> =
  (models?.PricingSnapshot as Model<PricingSnapshotDoc>) ||
  model<PricingSnapshotDoc>('PricingSnapshot', PricingSnapshotSchema);
