import { Schema, model, models, type Document, type Model } from 'mongoose';

export type TradeSide = 'buy' | 'sell';
export type TradeProposalStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'submitted'
  | 'failed'
  | 'expired'
  | 'cancelled';

export interface TradeProposalAttrs {
  userId: string;
  symbol: string;
  side: TradeSide;
  qty?: number;
  notional?: number;
  entry: number;
  stop: number;
  target: number;
  targets?: { t1: number; t2: number };
  maxSlippageBps: number;
  orderType: 'limit' | 'market';
  rationale: string;
  status: TradeProposalStatus;
  pricingSnapshotId: string;
  analysisReportId?: string;
  expiresAt: Date;
  editedByUser?: boolean;
  rejectionReason?: string;
  approvedAt?: Date;
  submittedAt?: Date;
  alpacaOrderId?: string;
  alpacaClientOrderId?: string;
  paper: boolean;
  riskNotes?: string[];
  rMultiple?: number;
}

export interface TradeProposalDoc extends TradeProposalAttrs, Document {}

const TradeProposalSchema = new Schema<TradeProposalDoc>(
  {
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true, index: true },
    side: { type: String, required: true, enum: ['buy', 'sell'] },
    qty: { type: Number },
    notional: { type: Number },
    entry: { type: Number, required: true },
    stop: { type: Number, required: true },
    target: { type: Number, required: true },
    targets: {
      t1: Number,
      t2: Number,
    },
    maxSlippageBps: { type: Number, required: true },
    orderType: { type: String, required: true, enum: ['limit', 'market'], default: 'limit' },
    rationale: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ['proposed', 'approved', 'rejected', 'submitted', 'failed', 'expired', 'cancelled'],
      default: 'proposed',
      index: true,
    },
    pricingSnapshotId: { type: String, required: true },
    analysisReportId: { type: String },
    expiresAt: { type: Date, required: true, index: true },
    editedByUser: { type: Boolean, default: false },
    rejectionReason: { type: String },
    approvedAt: { type: Date },
    submittedAt: { type: Date },
    alpacaOrderId: { type: String },
    alpacaClientOrderId: { type: String },
    paper: { type: Boolean, required: true, default: true },
    riskNotes: [{ type: String }],
    rMultiple: { type: Number },
  },
  { timestamps: true }
);

TradeProposalSchema.index({ userId: 1, symbol: 1, status: 1 });
TradeProposalSchema.index({ userId: 1, createdAt: -1 });

export const TradeProposal: Model<TradeProposalDoc> =
  (models?.TradeProposal as Model<TradeProposalDoc>) ||
  model<TradeProposalDoc>('TradeProposal', TradeProposalSchema);
