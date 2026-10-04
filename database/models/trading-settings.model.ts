import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface TradingSettingsAttrs {
  userId: string;
  killSwitch: boolean;
  paperTrading: boolean;
  maxPositionPct: number;
  maxDailyProposals: number;
  requireLiveConfirmPhrase: boolean;
  telegramChatId?: string;
  discordWebhookUrl?: string;
  notifyEmail: boolean;
  notifyTelegram: boolean;
  notifyDiscord: boolean;
}

export interface TradingSettingsDoc extends TradingSettingsAttrs, Document {}

const TradingSettingsSchema = new Schema<TradingSettingsDoc>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    killSwitch: { type: Boolean, default: false },
    paperTrading: { type: Boolean, default: true },
    maxPositionPct: { type: Number, default: 5, min: 0.1, max: 100 },
    maxDailyProposals: { type: Number, default: 10, min: 1, max: 100 },
    requireLiveConfirmPhrase: { type: Boolean, default: true },
    telegramChatId: { type: String },
    discordWebhookUrl: { type: String },
    notifyEmail: { type: Boolean, default: true },
    notifyTelegram: { type: Boolean, default: false },
    notifyDiscord: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const TradingSettings: Model<TradingSettingsDoc> =
  (models?.TradingSettings as Model<TradingSettingsDoc>) ||
  model<TradingSettingsDoc>('TradingSettings', TradingSettingsSchema);
