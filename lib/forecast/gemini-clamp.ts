/**
 * Gemini explains forecasts and may nudge yHat only inside [lo80, hi80].
 * Never invents prices outside the baseline bands.
 */

import { clampYHatToBand } from './baseline';
import type { FeatureSnapshotValues, PriceForecastValues } from './types';

export async function explainAndClampForecasts(input: {
  features: FeatureSnapshotValues;
  forecasts: PriceForecastValues[];
  evidenceUrls: string[];
}): Promise<PriceForecastValues[]> {
  if (!process.env.GEMINI_API_KEY) {
    return input.forecasts.map((f) => ({
      ...f,
      rationale:
        f.rationale +
        ' (Gemini skipped — no GEMINI_API_KEY; baseline numbers unchanged.)',
    }));
  }

  try {
    const { callAIProviderWithFallback } = await import('@/lib/ai-provider');
    const compact = input.forecasts.map((f) => ({
      horizon: f.horizon,
      lastClose: f.lastClose,
      yHat: f.yHat,
      lo80: f.lo80,
      hi80: f.hi80,
      direction: f.direction,
    }));
    const media = {
      newsSentiment: input.features.newsSentiment,
      socialSentiment: input.features.socialSentiment,
      pressSentiment: input.features.pressSentiment,
      pressEventType: input.features.pressEventType,
    };

    const text = await callAIProviderWithFallback(
      `You explain swing price forecasts. The baseline bands are AUTHORITATIVE.
You may suggest a nudged yHat ONLY inside [lo80, hi80] for each horizon.
NEVER invent prices outside bands. NEVER invent new bands.

Symbol: ${input.features.symbol}
asOf: ${input.features.asOf}
Media factors: ${JSON.stringify(media)}
Evidence URLs: ${input.evidenceUrls.slice(0, 6).join(', ') || 'none'}
Baseline forecasts: ${JSON.stringify(compact)}

Return ONLY JSON:
{
  "rationale": "2-4 sentences citing news/social/press/price factors",
  "nudges": [{"horizon":"D1","yHat":number}, ...]
}`
    );

    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return input.forecasts;
    const parsed = JSON.parse(m[0]) as {
      rationale?: string;
      nudges?: Array<{ horizon: string; yHat: number }>;
    };
    const nudgeMap = new Map((parsed.nudges || []).map((n) => [n.horizon, n.yHat]));

    return input.forecasts.map((f) => {
      const nudged = nudgeMap.get(f.horizon);
      const yHat =
        typeof nudged === 'number' ? clampYHatToBand(nudged, f.lo80, f.hi80) : f.yHat;
      return {
        ...f,
        yHat,
        rationale: parsed.rationale || f.rationale,
        evidenceUrls: input.evidenceUrls.length ? input.evidenceUrls : f.evidenceUrls,
      };
    });
  } catch (e) {
    console.warn('Gemini explain/clamp failed', e);
    return input.forecasts;
  }
}
