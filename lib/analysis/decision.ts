/**
 * DSA-shaped analysis prompt + parse + clamp prices to PricingSnapshot bands.
 * Attribution: decision-report shape adapted from daily_stock_analysis (MIT, ZhuLinsen).
 */

import { callAIProviderWithFallback } from '@/lib/ai-provider';
import {
  clampToBand,
  sanitizeStop,
  type PricingSnapshotResult,
  type PriceBand,
} from '@/lib/pricing';

export interface AnalysisReportDraft {
  action: 'buy' | 'watch' | 'sell';
  score: number;
  trend: string;
  summary: string;
  catalysts: string[];
  risks: string[];
  checklist: string[];
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  evidenceUrls: string[];
  strategyLenses: string[];
  proposedEntry?: number;
  proposedStop?: number;
  proposedTarget?: number;
  rationale: string;
}

const STRATEGY_LENSES = ['trend', 'event-driven', 'mean-reversion'] as const;

export function buildDecisionPrompt(input: {
  symbol: string;
  pricing: PricingSnapshotResult;
  quoteSummary: string;
  mediaSummaries: string[];
  marketReviewSummary?: string;
  riskProfile?: string;
}): string {
  return `You are the Auto Day Trader decision engine inside OpenStock (AGPL fork).
Produce a JSON decision report inspired by daily_stock_analysis "决策仪表盘" fields.

CRITICAL PRICING RULES:
- Deterministic PricingSnapshot is AUTHORITATIVE for numbers.
- You may refine entry/stop/target ONLY inside the provided bands.
- NEVER invent prices from headlines alone.
- If no edge, action must be "watch".

Symbol: ${input.symbol}
Risk profile: ${input.riskProfile || 'unknown'}

Market review:
${input.marketReviewSummary || 'n/a'}

Quote / tape:
${input.quoteSummary}

PricingSnapshot (authoritative):
${JSON.stringify(
  {
    last: input.pricing.last,
    mid: input.pricing.mid,
    regime: input.pricing.regime,
    sideHint: input.pricing.sideHint,
    fairValueBand: input.pricing.fairValueBand,
    entryZone: input.pricing.entryZone,
    stop: input.pricing.stop,
    targets: input.pricing.targets,
    expectedMove: input.pricing.expectedMove,
    maxSlippageBps: input.pricing.maxSlippageBps,
    confidence: input.pricing.confidence,
    atr14: input.pricing.atr14,
    vwap: input.pricing.vwap,
    openingRange: input.pricing.openingRange,
    relativeStrength: input.pricing.relativeStrength,
    microstructure: input.pricing.microstructure,
    notes: input.pricing.notes,
  },
  null,
  2
)}

News / media excerpts (evidence):
${input.mediaSummaries.slice(0, 8).join('\n---\n') || 'none'}

Strategy lenses to consider (v1): ${STRATEGY_LENSES.join(', ')}

Return ONLY valid JSON (no markdown) with this shape:
{
  "action": "buy" | "watch" | "sell",
  "score": 0-100,
  "trend": "short phrase",
  "summary": "2-4 sentences",
  "catalysts": ["..."],
  "risks": ["..."],
  "checklist": ["actionable checklist items"],
  "bias": "bullish" | "bearish" | "neutral",
  "confidence": 0-1,
  "evidenceUrls": ["https://..."],
  "strategyLenses": ["trend" | "event-driven" | "mean-reversion"],
  "proposedEntry": number,
  "proposedStop": number,
  "proposedTarget": number,
  "rationale": "why this proposal, referencing pricing bands"
}`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Model did not return JSON');
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String).filter(Boolean).slice(0, 12);
}

export function parseAnalysisDraft(raw: string): AnalysisReportDraft {
  const data = extractJson(raw) as Record<string, unknown>;
  const action = ['buy', 'watch', 'sell'].includes(String(data.action))
    ? (data.action as AnalysisReportDraft['action'])
    : 'watch';
  const bias = ['bullish', 'bearish', 'neutral'].includes(String(data.bias))
    ? (data.bias as AnalysisReportDraft['bias'])
    : 'neutral';
  return {
    action,
    score: Math.max(0, Math.min(100, Number(data.score) || 50)),
    trend: String(data.trend || 'unclear'),
    summary: String(data.summary || ''),
    catalysts: asStringArray(data.catalysts),
    risks: asStringArray(data.risks),
    checklist: asStringArray(data.checklist),
    bias,
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0.5)),
    evidenceUrls: asStringArray(data.evidenceUrls),
    strategyLenses: asStringArray(data.strategyLenses).filter((l) =>
      (STRATEGY_LENSES as readonly string[]).includes(l)
    ),
    proposedEntry: data.proposedEntry !== undefined ? Number(data.proposedEntry) : undefined,
    proposedStop: data.proposedStop !== undefined ? Number(data.proposedStop) : undefined,
    proposedTarget: data.proposedTarget !== undefined ? Number(data.proposedTarget) : undefined,
    rationale: String(data.rationale || data.summary || ''),
  };
}

/** Clamp model prices into PricingSnapshot bands; fall back to engine levels. */
export function clampProposalToPricing(
  draft: AnalysisReportDraft,
  pricing: PricingSnapshotResult
): {
  side: 'buy' | 'sell';
  entry: number;
  stop: number;
  target: number;
  action: AnalysisReportDraft['action'];
} {
  let action = draft.action;
  let side: 'buy' | 'sell' =
    action === 'sell' ? 'sell' : action === 'buy' ? 'buy' : pricing.sideHint === 'sell' ? 'sell' : 'buy';

  if (action === 'watch' || pricing.sideHint === 'flat') {
    action = 'watch';
  }

  const entryBand: PriceBand = pricing.entryZone;
  const entry = clampToBand(
    draft.proposedEntry ?? entryBand.mid,
    entryBand
  );
  const atr = pricing.atr14 ?? pricing.last * 0.015;
  let stop = sanitizeStop(
    side,
    entry,
    draft.proposedStop ?? pricing.stop,
    atr
  );
  let target = draft.proposedTarget ?? (side === 'buy' ? pricing.targets.t1 : pricing.targets.t1);

  // Keep target on correct side and roughly inside expected move envelope
  if (side === 'buy' && target <= entry) target = pricing.targets.t1;
  if (side === 'sell' && target >= entry) target = pricing.targets.t1;

  // Soft clamp target near engine targets
  const tBand: PriceBand =
    side === 'buy'
      ? {
          low: Math.min(pricing.targets.t1, pricing.targets.t2),
          mid: pricing.targets.t1,
          high: Math.max(pricing.targets.t1, pricing.targets.t2) * 1.02,
        }
      : {
          low: Math.min(pricing.targets.t1, pricing.targets.t2) * 0.98,
          mid: pricing.targets.t1,
          high: Math.max(pricing.targets.t1, pricing.targets.t2),
        };
  target = clampToBand(target, tBand);

  return { side, entry, stop, target, action };
}

export async function generateAnalysisReport(input: {
  symbol: string;
  pricing: PricingSnapshotResult;
  quoteSummary: string;
  mediaSummaries: string[];
  marketReviewSummary?: string;
  riskProfile?: string;
}): Promise<{ draft: AnalysisReportDraft; raw: string; clamped: ReturnType<typeof clampProposalToPricing> }> {
  const prompt = buildDecisionPrompt(input);
  let raw: string;
  try {
    raw = await callAIProviderWithFallback(prompt);
  } catch (e) {
    console.error('Analysis AI failed, using heuristic draft', e);
    raw = JSON.stringify({
      action: input.pricing.sideHint === 'flat' ? 'watch' : input.pricing.sideHint === 'sell' ? 'sell' : 'buy',
      score: Math.round(input.pricing.confidence * 100),
      trend: input.pricing.regime,
      summary: `Heuristic report (AI unavailable). Regime ${input.pricing.regime}; side hint ${input.pricing.sideHint}.`,
      catalysts: input.mediaSummaries.length ? ['Recent headlines present — review evidence'] : [],
      risks: input.pricing.notes,
      checklist: ['Confirm levels vs PricingSnapshot', 'Size within max position %', 'Approve only if R-multiple acceptable'],
      bias: input.pricing.sideHint === 'sell' ? 'bearish' : input.pricing.sideHint === 'buy' ? 'bullish' : 'neutral',
      confidence: input.pricing.confidence,
      evidenceUrls: [],
      strategyLenses: [input.pricing.regime === 'mean_reversion' ? 'mean-reversion' : 'trend'],
      proposedEntry: input.pricing.entryZone.mid,
      proposedStop: input.pricing.stop,
      proposedTarget: input.pricing.targets.t1,
      rationale: 'Fallback heuristic from PricingEngine only.',
    });
  }
  const draft = parseAnalysisDraft(raw);
  const clamped = clampProposalToPricing(draft, input.pricing);
  draft.action = clamped.action;
  return { draft, raw, clamped };
}
