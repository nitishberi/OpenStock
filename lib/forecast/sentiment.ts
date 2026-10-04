/**
 * Local polarity for media features. Prefers VADER compound scores; blends a
 * small finance lexicon when VADER is near-neutral (common on ticker chatter).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const vader = require('vader-sentiment') as {
  SentimentIntensityAnalyzer: {
    polarity_scores: (text: string) => {
      neg: number;
      neu: number;
      pos: number;
      compound: number;
    };
  };
};

const POS_RE =
  /\b(beat|beats|surge|surges|rally|gain|gains|growth|record|strong|upgrade|outperform|bullish|profit|raise|raises|moon|mooning|breakout|long)\b/gi;
const NEG_RE =
  /\b(miss|misses|fall|falls|drop|drops|weak|downgrade|lawsuit|probe|cut|cuts|bearish|loss|decline|recall|crash|short|baghold)\b/gi;

/** Lightweight finance lexicon polarity in [-1, 1]. */
export function lexiconPolarity(text: string): number {
  const t = text || '';
  const pos = (t.match(POS_RE) || []).length;
  const neg = (t.match(NEG_RE) || []).length;
  if (pos + neg === 0) return 0;
  return (pos - neg) / (pos + neg);
}

/** VADER compound in [-1, 1], blended with lexicon when VADER ≈ 0. */
export function scorePolarity(text: string): number {
  const raw = (text || '').trim();
  if (!raw) return 0;
  let compound = 0;
  try {
    compound = vader.SentimentIntensityAnalyzer.polarity_scores(raw).compound;
  } catch {
    compound = 0;
  }
  const lex = lexiconPolarity(raw);
  if (Math.abs(compound) < 0.05 && lex !== 0) {
    return Math.max(-1, Math.min(1, lex * 0.7));
  }
  if (Math.abs(lex) > 0.3 && Math.sign(lex) === Math.sign(compound || lex)) {
    return Math.max(-1, Math.min(1, compound * 0.7 + lex * 0.3));
  }
  return Math.max(-1, Math.min(1, compound));
}

/** Bull/bear skew from scored snippets: (bull − bear) / n ∈ [-1, 1]. */
export function bullBearSkew(scores: number[], bullThresh = 0.05, bearThresh = -0.05): number {
  if (!scores.length) return 0;
  let bull = 0;
  let bear = 0;
  for (const s of scores) {
    if (s > bullThresh) bull++;
    else if (s < bearThresh) bear++;
  }
  return (bull - bear) / scores.length;
}
