/**
 * Ingest filled forecast workbook Actual closes → resolved PriceForecast rows.
 *
 * Usage:
 *   npx tsx scripts/ingest-forecast-workbook.ts [--file=/path/to.xlsx] [--dry-run]
 *
 * For each ticker sheet with Actual close values:
 *   - upsert PriceForecast status=resolved with error fields
 *   - attach FeatureSnapshot when present; else rebuild from bars ≤ asOf (no lookahead)
 *
 * Requires MONGODB_URI + Finnhub keys when rebuilding features. Does not place orders.
 */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import ExcelJS from 'exceljs';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local') });

const DEFAULT_FILE =
  '/cursor/stores/bc-01a105ad-9570-7e37-ab99-7b946307cee4/docs/exports/forecast-50-stocks-d1d5.xlsx';

const HORIZONS = new Set(['D1', 'D2', 'D3', 'D5']);

function parseArgs(argv: string[]) {
  const fileArg = argv.find((a) => a.startsWith('--file='));
  return {
    file: fileArg ? fileArg.split('=')[1] : DEFAULT_FILE,
    dryRun: argv.includes('--dry-run'),
  };
}

function cellNum(v: ExcelJS.CellValue): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'object' && v && 'result' in v) {
    const r = (v as { result?: unknown }).result;
    if (typeof r === 'number' && Number.isFinite(r)) return r;
  }
  if (typeof v === 'string') {
    const n = Number(v.replace(/[$,]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function cellStr(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && v && 'text' in v) return String((v as { text: string }).text).trim();
  if (typeof v === 'object' && v && 'result' in v) return String((v as { result?: unknown }).result ?? '').trim();
  return String(v).trim();
}

type SheetMeta = {
  symbol: string;
  sector: string;
  asOf: string;
  modelVersion: string;
  lastClose: number;
};

type HorizonRow = {
  horizon: 'D1' | 'D2' | 'D3' | 'D5';
  targetDate: string;
  yHat: number;
  lo80: number;
  hi80: number;
  direction: 'up' | 'down' | 'flat';
  confidence: number;
  actualClose: number;
};

function parseTickerSheet(ws: ExcelJS.Worksheet): { meta: SheetMeta; rows: HorizonRow[] } | null {
  const label = (r: number) => cellStr(ws.getCell(r, 1).value).toLowerCase();
  const val = (r: number) => ws.getCell(r, 2).value;

  let symbol = '';
  let sector = 'Unknown';
  let asOf = '';
  let modelVersion = 'swing-baseline-v2';
  let lastClose = NaN;

  for (let r = 1; r <= 10; r++) {
    const l = label(r);
    if (l === 'symbol') symbol = cellStr(val(r)).toUpperCase();
    if (l === 'sector') sector = cellStr(val(r)) || 'Unknown';
    if (l === 'asof') asOf = cellStr(val(r));
    if (l === 'modelversion') modelVersion = cellStr(val(r)) || modelVersion;
    if (l === 'lastclose') lastClose = cellNum(val(r)) ?? NaN;
  }

  if (!symbol || !asOf || !Number.isFinite(lastClose) || lastClose <= 0) return null;

  // Find header row with "Horizon"
  let headerRow = 8;
  for (let r = 1; r <= 20; r++) {
    if (cellStr(ws.getCell(r, 1).value).toLowerCase() === 'horizon') {
      headerRow = r;
      break;
    }
  }

  const rows: HorizonRow[] = [];
  for (let r = headerRow + 1; r <= headerRow + 6; r++) {
    const h = cellStr(ws.getCell(r, 1).value).toUpperCase();
    if (!HORIZONS.has(h)) continue;
    const actualClose = cellNum(ws.getCell(r, 8).value);
    if (actualClose == null || actualClose <= 0) continue;
    const yHat = cellNum(ws.getCell(r, 3).value);
    const lo80 = cellNum(ws.getCell(r, 4).value);
    const hi80 = cellNum(ws.getCell(r, 5).value);
    const directionRaw = cellStr(ws.getCell(r, 6).value).toLowerCase();
    const direction =
      directionRaw === 'up' || directionRaw === 'down' || directionRaw === 'flat'
        ? directionRaw
        : 'flat';
    const confidence = cellNum(ws.getCell(r, 7).value) ?? 0.45;
    const targetDate = cellStr(ws.getCell(r, 2).value);
    if (yHat == null || lo80 == null || hi80 == null) continue;
    rows.push({
      horizon: h as HorizonRow['horizon'],
      targetDate,
      yHat,
      lo80,
      hi80,
      direction,
      confidence,
      actualClose,
    });
  }

  if (!rows.length) return null;
  return {
    meta: { symbol, sector, asOf, modelVersion, lastClose },
    rows,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.file)) {
    console.error(`File not found: ${args.file}`);
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(args.file);
  console.log(`Loaded ${args.file} (${wb.worksheets.length} sheets)`);

  const parsed: Array<{ meta: SheetMeta; rows: HorizonRow[] }> = [];
  for (const ws of wb.worksheets) {
    if (ws.name.startsWith('_')) continue;
    const p = parseTickerSheet(ws);
    if (p) parsed.push(p);
  }
  console.log(`Parsed ${parsed.length} ticker sheets with Actual closes`);

  if (args.dryRun) {
    const n = parsed.reduce((a, p) => a + p.rows.length, 0);
    console.log(`Dry run: would upsert ${n} resolved PriceForecast rows`);
    for (const p of parsed.slice(0, 3)) {
      console.log(
        `  ${p.meta.symbol} asOf=${p.meta.asOf} horizons=${p.rows.map((r) => r.horizon).join(',')}`
      );
    }
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI required for ingest (set via .env / secrets)');
    process.exit(1);
  }

  const mongoose = (await import('mongoose')).default;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });

  const { FeatureSnapshot } = await import('../database/models/feature-snapshot.model');
  const { PriceForecast } = await import('../database/models/price-forecast.model');
  const {
    assembleFeatureSnapshot,
    fetchDailyBars,
    sectorEtfSymbol,
    emptyNewsFeatures,
    emptySocialFeatures,
    emptyPressFeatures,
    emptyInsiderFeatures,
  } = await import('../lib/forecast');

  let spyBars: Awaited<ReturnType<typeof fetchDailyBars>> = [];
  try {
    spyBars = await fetchDailyBars('SPY');
  } catch (e) {
    console.warn('SPY bars unavailable:', e instanceof Error ? e.message : e);
  }
  const sectorBarsCache = new Map<string, Awaited<ReturnType<typeof fetchDailyBars>>>();
  const barsCache = new Map<string, Awaited<ReturnType<typeof fetchDailyBars>>>();

  let upserted = 0;
  let snapshotsBuilt = 0;
  let snapshotsReused = 0;
  let errors = 0;

  for (const { meta, rows } of parsed) {
    try {
      let snap = await FeatureSnapshot.findOne({ symbol: meta.symbol, asOf: meta.asOf }).lean();
      if (!snap) {
        // Rebuild features from bars ≤ asOf (no lookahead)
        if (!barsCache.has(meta.symbol)) {
          barsCache.set(meta.symbol, await fetchDailyBars(meta.symbol));
          await new Promise((r) => setTimeout(r, 250));
        }
        const bars = barsCache.get(meta.symbol)!;
        const etf = sectorEtfSymbol(meta.sector);
        let sectorBars: Awaited<ReturnType<typeof fetchDailyBars>> | undefined;
        if (etf) {
          if (!sectorBarsCache.has(etf)) {
            try {
              sectorBarsCache.set(etf, await fetchDailyBars(etf));
              await new Promise((r) => setTimeout(r, 200));
            } catch {
              sectorBarsCache.set(etf, []);
            }
          }
          sectorBars = sectorBarsCache.get(etf);
        }
        const { features } = assembleFeatureSnapshot({
          symbol: meta.symbol,
          asOf: meta.asOf,
          sector: meta.sector,
          bars,
          spyBars,
          sectorBars,
          news: emptyNewsFeatures(),
          social: emptySocialFeatures(),
          press: emptyPressFeatures(),
          insider: emptyInsiderFeatures(),
        });
        await FeatureSnapshot.findOneAndUpdate(
          { symbol: meta.symbol, asOf: meta.asOf },
          { $set: features },
          { upsert: true }
        );
        snap = await FeatureSnapshot.findOne({ symbol: meta.symbol, asOf: meta.asOf }).lean();
        snapshotsBuilt++;
      } else {
        snapshotsReused++;
      }

      for (const row of rows) {
        const absError = Math.abs(row.yHat - row.actualClose);
        const pctError = absError / row.actualClose;
        const signedError = row.yHat - row.actualClose;
        const actDir =
          row.actualClose > meta.lastClose * 1.0015
            ? 'up'
            : row.actualClose < meta.lastClose * 0.9985
              ? 'down'
              : 'flat';
        const directionHit = row.direction === actDir;
        const inside80 = row.actualClose >= row.lo80 && row.actualClose <= row.hi80;

        await PriceForecast.findOneAndUpdate(
          {
            symbol: meta.symbol,
            asOf: meta.asOf,
            horizon: row.horizon,
            modelVersion: meta.modelVersion,
          },
          {
            $set: {
              symbol: meta.symbol,
              asOf: meta.asOf,
              horizon: row.horizon,
              lastClose: meta.lastClose,
              yHat: row.yHat,
              lo80: row.lo80,
              hi80: row.hi80,
              direction: row.direction,
              confidence: row.confidence,
              featureVectorId: snap ? String(snap._id) : undefined,
              modelVersion: meta.modelVersion,
              rationale: `Ingested from workbook; target=${row.targetDate}`,
              evidenceUrls: [],
              status: 'resolved',
              actualClose: row.actualClose,
              absError,
              pctError,
              signedError,
              directionHit,
              inside80,
            },
          },
          { upsert: true }
        );
        upserted++;
      }
      console.log(`OK ${meta.symbol}: ${rows.length} horizons`);
    } catch (e) {
      errors++;
      console.warn(`FAIL ${meta.symbol}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(
    JSON.stringify(
      {
        file: args.file,
        tickers: parsed.length,
        upserted,
        snapshotsBuilt,
        snapshotsReused,
        errors,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
