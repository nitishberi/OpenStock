import { Schema, model, models, type Document, type Model } from 'mongoose';

export type MediaSourceKind = 'tavily' | 'brave' | 'serpapi' | 'rss' | 'finnhub' | 'manual' | 'adanos';
export type MediaChannel = 'news' | 'social' | 'press';

export interface MediaDocumentAttrs {
  symbol?: string;
  title: string;
  url: string;
  source: string;
  sourceKind: MediaSourceKind;
  /** Narrative channel for prediction features / attribution. */
  channel?: MediaChannel;
  excerpt?: string;
  body?: string;
  publishedAt?: Date;
  fetchedAt: Date;
  domain: string;
  score?: number;
  tags?: string[];
  raw?: Record<string, unknown>;
}

export interface MediaDocumentDoc extends MediaDocumentAttrs, Document {}

const MediaDocumentSchema = new Schema<MediaDocumentDoc>(
  {
    symbol: { type: String, uppercase: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    source: { type: String, required: true, trim: true },
    sourceKind: {
      type: String,
      required: true,
      enum: ['tavily', 'brave', 'serpapi', 'rss', 'finnhub', 'manual', 'adanos'],
    },
    channel: {
      type: String,
      enum: ['news', 'social', 'press'],
      default: 'news',
      index: true,
    },
    excerpt: { type: String },
    body: { type: String },
    publishedAt: { type: Date },
    fetchedAt: { type: Date, required: true, default: Date.now },
    domain: { type: String, required: true, index: true },
    score: { type: Number },
    tags: [{ type: String }],
    raw: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

MediaDocumentSchema.index({ url: 1 }, { unique: true });
MediaDocumentSchema.index({ symbol: 1, fetchedAt: -1 });

export const MediaDocument: Model<MediaDocumentDoc> =
  (models?.MediaDocument as Model<MediaDocumentDoc>) ||
  model<MediaDocumentDoc>('MediaDocument', MediaDocumentSchema);
