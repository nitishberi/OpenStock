import { Schema, model, models, type Document, type Model } from 'mongoose';

export type OrderAuditEvent =
  | 'proposal_created'
  | 'proposal_edited'
  | 'proposal_approved'
  | 'proposal_rejected'
  | 'order_submitted'
  | 'order_failed'
  | 'kill_switch'
  | 'risk_blocked';

export interface OrderAuditAttrs {
  userId: string;
  proposalId?: string;
  symbol?: string;
  event: OrderAuditEvent;
  paper: boolean;
  detail: string;
  payload?: Record<string, unknown>;
}

export interface OrderAuditDoc extends OrderAuditAttrs, Document {}

const OrderAuditSchema = new Schema<OrderAuditDoc>(
  {
    userId: { type: String, required: true, index: true },
    proposalId: { type: String, index: true },
    symbol: { type: String, uppercase: true, trim: true },
    event: {
      type: String,
      required: true,
      enum: [
        'proposal_created',
        'proposal_edited',
        'proposal_approved',
        'proposal_rejected',
        'order_submitted',
        'order_failed',
        'kill_switch',
        'risk_blocked',
      ],
    },
    paper: { type: Boolean, required: true, default: true },
    detail: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

OrderAuditSchema.index({ userId: 1, createdAt: -1 });

export const OrderAudit: Model<OrderAuditDoc> =
  (models?.OrderAudit as Model<OrderAuditDoc>) ||
  model<OrderAuditDoc>('OrderAudit', OrderAuditSchema);
