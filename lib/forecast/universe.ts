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
