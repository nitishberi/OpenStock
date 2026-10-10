import universeJson from '@/config/forecast-universe-100.json';

export interface UniverseSymbol {
  symbol: string;
  name: string;
  sector: string;
}

export interface ForecastUniverse {
  name: string;
  asOf: string;
  count: number;
  symbols: UniverseSymbol[];
}

export function getForecastUniverse(): ForecastUniverse {
  const data = universeJson as ForecastUniverse;
  if (!Array.isArray(data.symbols) || data.symbols.length !== 100) {
    throw new Error(`forecast-universe-100.json must contain exactly 100 symbols (got ${data.symbols?.length})`);
  }
  return data;
}

export function getUniverseSymbols(): string[] {
  return getForecastUniverse().symbols.map((s) => s.symbol);
}

export function getSectorMap(): Map<string, string> {
  return new Map(getForecastUniverse().symbols.map((s) => [s.symbol, s.sector]));
}

/** Select SPDR sector ETF for a GICS-style sector name (for sectorRel5d). */
export const SECTOR_ETF_BY_NAME: Record<string, string> = {
  Technology: 'XLK',
  'Information Technology': 'XLK',
  Financials: 'XLF',
  Energy: 'XLE',
  'Health Care': 'XLV',
  Healthcare: 'XLV',
  Industrials: 'XLI',
  'Consumer Discretionary': 'XLY',
  'Consumer Staples': 'XLP',
  Utilities: 'XLU',
  Materials: 'XLB',
  'Real Estate': 'XLRE',
  'Communication Services': 'XLC',
  Communications: 'XLC',
};

export function sectorEtfSymbol(sector: string): string | undefined {
  return SECTOR_ETF_BY_NAME[sector];
}

/** Unique sector ETF tickers needed for a set of sector names. */
export function sectorEtfsForSectors(sectors: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const s of sectors) {
    const etf = sectorEtfSymbol(s);
    if (etf) out.add(etf);
  }
  return [...out];
}
