/** Clean-room Order Blocks board contracts (OpenStock feature). */

export type OrderBlockSide = 'bullish' | 'bearish';

export interface OrderBlockZones {
  /** Last opposite candle before impulse — low. */
  orderBlockLow: number;
  /** Last opposite candle before impulse — high. */
  orderBlockHigh: number;
  /** Action zone (mid of OB). */
  zoneZ: number;
  /** Invalidation: S1 for bullish, R1 for bearish. */
  invalidation: number;
  /** Liquidity / swing level in trade direction. */
  liquidity: number;
  support: number;
  resistance: number;
}

export interface OrderBlockRow {
  symbol: string;
  company?: string;
  sector: string;
  side: OrderBlockSide;
  rank: number;
  /** Signed strength: + bullish, − bearish. |strength| used for ranking. */
  strength: number;
  /** Session % change from open. */
  pctChange: number;
  last: number;
  isPick: boolean;
  ruleNote: string;
  zones: OrderBlockZones | null;
}

export interface SectorFlow {
  sector: string;
  avgStrength: number;
  count: number;
}

export interface OrderBlockBoard {
  asOf: string;
  generatedAt: string;
  universeSize: number;
  scored: number;
  bullishCount: number;
  bearishCount: number;
  leadSector: string | null;
  lagSector: string | null;
  bullish: OrderBlockRow[];
  bearish: OrderBlockRow[];
  sectors: SectorFlow[];
  disclaimer: string;
}
