/**
 * Export D1–D5 close forecasts for 50 seeded random universe stocks to Excel.
 *
 * Usage:
 *   npx tsx scripts/export-forecast-workbook.ts [--seed=42] [--count=50] [--live-media] [--no-gemini]
 *     [--out=/path/to/forecast-50-stocks-d1d5.xlsx]
 *
 * Loads active Mongo weights when available (prefer swing-baseline-v2); otherwise
 * trains a candidate offline and uses it if the holdout gate promotes; else v1.
 * Does not place orders. Workbook goes to the Project store path by default.
 */

import { config } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import ExcelJS from 'exceljs';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local') });

const DEFAULT_OUT =
  '/cursor/stores/bc-01a105ad-9570-7e37-ab99-7b946307cee4/docs/exports/forecast-50-stocks-d1d5.xlsx';
const DEFAULT_README =
  '/cursor/stores/bc-01a105ad-9570-7e37-ab99-7b946307cee4/docs/exports/forecast-50-stocks-readme.md';
const WEIGHTS_CACHE =
  '/cursor/stores/bc-01a105ad-9570-7e37-ab99-7b946307cee4/artifacts/swing-baseline-v2.weights.json';

const SEED_DEFAULT = 42;
const COUNT_DEFAULT = 50;

type UniverseRow = { symbol: string; name: string; sector: string };

function parseArgs(argv: string[]) {
  const seedArg = argv.find((a) => a.startsWith('--seed='));
  const countArg = argv.find((a) => a.startsWith('--count='));
  const outArg = argv.find((a) => a.startsWith('--out='));
  const readmeArg = argv.find((a) => a.startsWith('--readme='));
  return {
    seed: seedArg ? Number(seedArg.split('=')[1]) : SEED_DEFAULT,
    count: countArg ? Number(countArg.split('=')[1]) : COUNT_DEFAULT,
    liveMedia: argv.includes('--live-media'),
    noGemini: argv.includes('--no-gemini'),
    out: outArg ? outArg.split('=')[1] : DEFAULT_OUT,
    readme: readmeArg ? readmeArg.split('=')[1] : DEFAULT_README,
  };
}

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleUniverse(symbols: UniverseRow[], count: number, seed: number): UniverseRow[] {
  const rng = mulberry32(seed);
  const arr = [...symbols];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

function excelSafeSheetName(symbol: string): string {
  // Excel: max 31 chars; forbid : \ / ? * [ ]
  return symbol.replace(/[:\\/?*\[\]]/g, '_').slice(0, 31);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadWeightsFromMongo(): Promise<import('../lib/forecast').ModelWeightsPayload | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  try {
    const mongoose = (await import('mongoose')).default;
    // Fast-fail when mongod is not running on this worker.
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2500,
      connectTimeoutMS: 2500,
    });
    const { ModelWeights } = await import('../database/models/model-weights.model');
    const active = await ModelWeights.findOne({ active: true }).lean();
    if (active?.payload) {
      console.log(`Loaded active Mongo weights: ${(active.payload as { version?: string }).version}`);
      return active.payload as import('../lib/forecast').ModelWeightsPayload;
    }
    const v2 = await ModelWeights.findOne({ version: 'swing-baseline-v2' }).lean();
    if (v2?.payload) {
      console.log('Loaded swing-baseline-v2 from Mongo (not marked active)');
      return v2.payload as import('../lib/forecast').ModelWeightsPayload;
    }
  } catch (e) {
    console.warn('Mongo weights unavailable:', e instanceof Error ? e.message : e);
  } finally {
    try {
      const mongoose = (await import('mongoose')).default;
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function trainOfflineCandidate(): Promise<import('../lib/forecast').ModelWeightsPayload | null> {
  const {
    createSwingBaselineV1,
    runStrategyTest,
    trainFromRows,
    nextModelVersion,
  } = await import('../lib/forecast');

  const parent = createSwingBaselineV1();
  console.log('Training offline candidate (40 symbols × 100 days, price-only)…');
  const result = await runStrategyTest({
    weights: parent,
    symbolLimit: 40,
    windowDays: 100,
    liveMedia: false,
    delayMs: 200,
    onProgress: (m) => console.log(m),
  });
  const trained = trainFromRows({
    rows: result.trainRows,
    parent,
    holdoutAsOfs: new Set(result.holdoutAsOfs),
    nextVersion: nextModelVersion(parent.version),
  });
  console.log('Train gate:', {
    promoted: trained.promoted,
    version: trained.candidate.version,
    reason: trained.reason,
  });
  if (trained.promoted) return trained.candidate;
  console.warn('Offline train did not promote; falling back to builtin v1 priors.');
  return null;
}

function loadCachedWeights(): import('../lib/forecast').ModelWeightsPayload | null {
  try {
    if (!existsSync(WEIGHTS_CACHE)) return null;
    const parsed = JSON.parse(readFileSync(WEIGHTS_CACHE, 'utf8')) as import('../lib/forecast').ModelWeightsPayload;
    if (parsed?.version && parsed?.coefficients && parsed?.blend) {
      console.log(`Loaded cached weights: ${parsed.version} from ${WEIGHTS_CACHE}`);
      return parsed;
    }
  } catch (e) {
    console.warn('Weights cache unreadable:', e instanceof Error ? e.message : e);
  }
  return null;
}

function saveCachedWeights(weights: import('../lib/forecast').ModelWeightsPayload) {
  try {
    mkdirSync(dirname(WEIGHTS_CACHE), { recursive: true });
    writeFileSync(WEIGHTS_CACHE, JSON.stringify(weights, null, 2), 'utf8');
    console.log(`Cached weights → ${WEIGHTS_CACHE}`);
  } catch (e) {
    console.warn('Could not cache weights:', e instanceof Error ? e.message : e);
  }
}

async function resolveWeights(): Promise<{
  weights: import('../lib/forecast').ModelWeightsPayload;
  source: string;
}> {
  const fromMongo = await loadWeightsFromMongo();
  if (fromMongo) {
    if (fromMongo.version.includes('v2')) saveCachedWeights(fromMongo);
    return { weights: fromMongo, source: 'mongodb-active' };
  }

  const cached = loadCachedWeights();
  if (cached) {
    return { weights: cached, source: 'project-store-cache' };
  }

  try {
    const trained = await trainOfflineCandidate();
    if (trained) {
      saveCachedWeights(trained);
      return {
        weights: trained,
        source: trained.version === 'swing-baseline-v2' ? 'offline-train-v2' : `offline-train-${trained.version}`,
      };
    }
  } catch (e) {
    console.warn('Offline train failed:', e instanceof Error ? e.message : e);
  }

  const { createSwingBaselineV1 } = await import('../lib/forecast');
  const v1 = createSwingBaselineV1();
  return { weights: v1, source: 'builtin-v1-fallback' };
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E79' },
  };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {
    getForecastUniverse,
    getSectorMap,
    previousTradingDayOnOrBefore,
    toUtcDateString,
    addTradingDays,
    HORIZON_DAYS,
    FORECAST_HORIZONS,
    fetchDailyBars,
    assembleFeatureSnapshot,
    forecastHorizons,
    collectMediaFeatures,
    collectInsiderFeatures,
    emptyNewsFeatures,
    emptySocialFeatures,
    emptyPressFeatures,
    emptyInsiderFeatures,
    explainAndClampForecasts,
  } = await import('../lib/forecast');

  const universe = getForecastUniverse();
  const picked = sampleUniverse(universe.symbols, args.count, args.seed);
  const sectorMap = getSectorMap();
  const nameMap = new Map(universe.symbols.map((s) => [s.symbol, s.name]));

  console.log(`Sample seed=${args.seed} count=${picked.length}`);
  console.log(picked.map((s) => s.symbol).join(','));

  const { weights, source: weightSource } = await resolveWeights();
  console.log(`Using modelVersion=${weights.version} source=${weightSource}`);

  // asOf = prior US trading day (NYSE holiday-aware)
  let asOf = toUtcDateString(previousTradingDayOnOrBefore(new Date()));

  console.log('Loading SPY bars…');
  let spyBars: Awaited<ReturnType<typeof fetchDailyBars>> = [];
  try {
    spyBars = await fetchDailyBars('SPY');
  } catch (e) {
    console.warn('SPY bars failed', e);
  }

  // Align asOf to last available bar if VM clock is ahead of tape
  if (spyBars.length) {
    const last = spyBars.at(-1)!;
    const barEnd = toUtcDateString(new Date(last.t < 1e12 ? last.t * 1000 : last.t));
    if (barEnd < asOf) {
      console.log(`Clock ahead of tape; aligning asOf ${asOf} → ${barEnd}`);
      asOf = barEnd;
    }
  }

  type StockBundle = {
    symbol: string;
    name: string;
    sector: string;
    lastClose: number;
    forecasts: import('../lib/forecast').PriceForecastValues[];
    rationale: string;
    evidenceUrls: string[];
    mediaNote: string;
    insiderBuyCount7d: number;
    insiderBuyValue7d: number;
    insiderClusterBuy: number;
    insiderEvidence?: string | null;
    error?: string;
  };

  const bundles: StockBundle[] = [];

  for (let i = 0; i < picked.length; i++) {
    const row = picked[i];
    const symbol = row.symbol;
    console.log(`[${i + 1}/${picked.length}] Forecasting ${symbol}…`);
    try {
      const bars = await fetchDailyBars(symbol);
      await sleep(300);

      let news = emptyNewsFeatures();
      let social = emptySocialFeatures();
      let press = emptyPressFeatures();
      let insider = emptyInsiderFeatures();
      let evidenceUrls: string[] = [];
      let mediaNote = 'Media: baseline (zeros) — live intake skipped.';
      let insiderEvidence: string | null = null;

      if (args.liveMedia) {
        try {
          const media = await collectMediaFeatures(symbol, {
            company: row.name,
            persist: false,
            enrichBodies: false,
          });
          news = media.news;
          social = media.social;
          press = media.press;
          evidenceUrls = media.evidenceUrls || [];
          mediaNote = `Media: newsCount48h=${news.newsCount48h}, newsSent=${news.newsSentiment.toFixed(3)}, socialVol=${social.socialVolume}, socialSent=${social.socialSentiment.toFixed(3)}, press7d=${press.pressCount7d}, pressSent=${press.pressSentiment.toFixed(3)}, pressEvent=${press.pressEventType}.`;
          await sleep(700);
        } catch (e) {
          mediaNote = `Media: intake failed (${e instanceof Error ? e.message : String(e)}); using zeros.`;
        }
      }

      try {
        const pack = await collectInsiderFeatures(symbol, asOf, { refreshTicker: false });
        insider = pack.features;
        insiderEvidence = pack.evidenceLine;
        evidenceUrls = [...evidenceUrls, ...pack.evidenceUrls];
        if (insider.insiderBuyCount7d > 0) {
          mediaNote += ` Insider: buys7d=${insider.insiderBuyCount7d}, value7d$${insider.insiderBuyValue7d.toFixed(2)}M, cluster=${insider.insiderClusterBuy}, ceoCfo=${insider.insiderCeoCfoBuy}.`;
        }
      } catch {
        /* zeros */
      }

      const { features, lastClose } = assembleFeatureSnapshot({
        symbol,
        asOf,
        sector: sectorMap.get(symbol) || row.sector || 'Unknown',
        bars,
        spyBars,
        news,
        social,
        press,
        insider,
      });

      let preds = forecastHorizons({
        features,
        lastClose,
        weights,
        evidenceUrls,
      });

      if (!args.noGemini && process.env.GEMINI_API_KEY) {
        try {
          preds = await explainAndClampForecasts({
            features,
            forecasts: preds,
            evidenceUrls,
          });
          // Stay under Gemini RPM when exporting many symbols.
          await sleep(1500);
        } catch (e) {
          console.warn(`Gemini explain failed for ${symbol}`, e);
        }
      }

      const rationale = preds[0]?.rationale || 'Baseline forecast.';
      bundles.push({
        symbol,
        name: nameMap.get(symbol) || row.name,
        sector: row.sector,
        lastClose,
        forecasts: preds,
        rationale,
        evidenceUrls,
        mediaNote,
        insiderBuyCount7d: insider.insiderBuyCount7d,
        insiderBuyValue7d: insider.insiderBuyValue7d,
        insiderClusterBuy: insider.insiderClusterBuy,
        insiderEvidence,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Failed ${symbol}:`, msg);
      bundles.push({
        symbol,
        name: nameMap.get(symbol) || row.name,
        sector: row.sector,
        lastClose: NaN,
        forecasts: [],
        rationale: '',
        evidenceUrls: [],
        mediaNote: '',
        insiderBuyCount7d: 0,
        insiderBuyValue7d: 0,
        insiderClusterBuy: 0,
        error: msg,
      });
    }
  }

  const okBundles = bundles.filter((b) => b.forecasts.length > 0);
  console.log(`Building workbook for ${okBundles.length}/${bundles.length} symbols…`);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'OpenStock export-forecast-workbook';
  wb.created = new Date();
  wb.modified = new Date();
  wb.properties = {
    title: 'OpenStock D1–D5 forecast export (50 stocks)',
    subject: `model=${weights.version} asOf=${asOf} seed=${args.seed}`,
  };

  // --- _Summary ---
  const summary = wb.addWorksheet('_Summary', {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 0 }],
  });
  summary.columns = [
    { header: 'Symbol', key: 'symbol', width: 10 },
    { header: 'Company', key: 'name', width: 28 },
    { header: 'Sector', key: 'sector', width: 18 },
    { header: 'asOf', key: 'asOf', width: 12 },
    { header: 'Model', key: 'model', width: 18 },
    { header: 'Last close', key: 'lastClose', width: 12 },
    { header: 'D1 yHat', key: 'd1', width: 11 },
    { header: 'D2 yHat', key: 'd2', width: 11 },
    { header: 'D3 yHat', key: 'd3', width: 11 },
    { header: 'D5 yHat', key: 'd5', width: 11 },
    { header: 'D1 dir', key: 'd1dir', width: 9 },
    { header: 'D1 conf', key: 'd1conf', width: 10 },
    { header: 'Sheet', key: 'sheet', width: 12 },
    { header: 'Insider buys 7d', key: 'insiderBuys', width: 14 },
    { header: 'Insider $M 7d', key: 'insiderValue', width: 14 },
    { header: 'Insider cluster', key: 'insiderCluster', width: 14 },
    { header: 'Insider note', key: 'insiderNote', width: 40 },
    { header: 'Note', key: 'note', width: 36 },
  ];
  styleHeaderRow(summary.getRow(1));

  for (const b of bundles) {
    const byH = Object.fromEntries(b.forecasts.map((f) => [f.horizon, f]));
    const sheet = excelSafeSheetName(b.symbol);
    summary.addRow({
      symbol: b.symbol,
      name: b.name,
      sector: b.sector,
      asOf,
      model: weights.version,
      lastClose: Number.isFinite(b.lastClose) ? b.lastClose : null,
      d1: byH.D1?.yHat ?? null,
      d2: byH.D2?.yHat ?? null,
      d3: byH.D3?.yHat ?? null,
      d5: byH.D5?.yHat ?? null,
      d1dir: byH.D1?.direction ?? (b.error ? 'ERR' : ''),
      d1conf: byH.D1?.confidence ?? null,
      sheet,
      insiderBuys: b.insiderBuyCount7d,
      insiderValue: b.insiderBuyValue7d,
      insiderCluster: b.insiderClusterBuy,
      insiderNote: b.insiderEvidence || '',
      note: b.error ? `FAILED: ${b.error}` : 'See sheet for bands + Actual close + explanation',
    });
  }

  for (const col of ['F', 'G', 'H', 'I', 'J']) {
    summary.getColumn(col).numFmt = '$#,##0.00';
  }
  summary.getColumn('L').numFmt = '0.0%';
  // confidence stored 0–1
  for (let r = 2; r <= summary.rowCount; r++) {
    const cell = summary.getCell(`L${r}`);
    if (typeof cell.value === 'number') {
      // already 0-1 fraction
    }
  }

  // --- _Instructions ---
  const instr = wb.addWorksheet('_Instructions');
  instr.getColumn(1).width = 100;
  const instrLines = [
    'OpenStock — D1/D2/D3/D5 closing-price forecast workbook',
    '',
    `asOf (last close used for features): ${asOf}`,
    `modelVersion: ${weights.version}`,
    `weights source: ${weightSource}`,
    `universe sample seed: ${args.seed}`,
    `symbols: ${picked.map((s) => s.symbol).join(', ')}`,
    `liveMedia: ${args.liveMedia}`,
    `generatedAt (UTC): ${new Date().toISOString()}`,
    '',
    'Sheet layout',
    '1) _Summary — one row per ticker with last close, D1–D5 yHat, D1 direction/confidence, sheet name.',
    '2) _Instructions — this page.',
    '3) One sheet per ticker — meta block, horizon table, Actual close column, Error % formula, explanation.',
    '',
    'How to fill actuals (end of next week)',
    '- For each ticker sheet, enter the official NYSE closing price in column H (Actual close) for each horizon row.',
    '- Target date (column B) is the trading day whose close you should use (holidays skipped).',
    '- Error % (column I) auto-calculates as (Actual − Predicted) / Predicted when Actual is filled.',
    '- Optional: note the actual trade date in the Actual date note cell if it differs from Target date.',
    '',
    'Re-ingest / training plan',
    '1) After D5 target dates have closed (end of next week), fill Actual close for all 50 × 4 horizon rows.',
    '2) Run resolve + train in the app (Forecast Lab → resolve due forecasts / train) or a CLI that reads this workbook.',
    '3) Future CLI: parse each ticker sheet, upsert PriceForecast status=resolved with actualClose, then trainFromRows → promote candidate.',
    '4) Keep this file immutable for the asOf cohort; copy to a dated archive before editing actuals if needed.',
    '',
    'Notes',
    '- Predictions are closing prices, not trade signals. Live trading is disabled.',
    '- 80% bands are baseline vol-scaled intervals; Gemini (when used) may only nudge yHat inside the band.',
    '- If Mongo lacked swing-baseline-v2 on the worker, weights source above records what was used.',
  ];
  instrLines.forEach((line, idx) => {
    const cell = instr.getCell(idx + 1, 1);
    cell.value = line;
    if (idx === 0) cell.font = { bold: true, size: 14, color: { argb: 'FF1F4E79' } };
    else if (line && !line.startsWith('-') && !line.startsWith('1)') && !/^[0-9]\)/.test(line) && line.length < 40 && !line.includes(':')) {
      cell.font = { bold: true, size: 12 };
    }
  });

  // --- Per-stock sheets ---
  for (const b of okBundles) {
    const sheetName = excelSafeSheetName(b.symbol);
    const ws = wb.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 8 }],
    });

    ws.getColumn(1).width = 14;
    ws.getColumn(2).width = 14;
    ws.getColumn(3).width = 14;
    ws.getColumn(4).width = 14;
    ws.getColumn(5).width = 14;
    ws.getColumn(6).width = 12;
    ws.getColumn(7).width = 12;
    ws.getColumn(8).width = 14;
    ws.getColumn(9).width = 12;
    ws.getColumn(10).width = 16;

    ws.getCell('A1').value = 'Symbol';
    ws.getCell('B1').value = b.symbol;
    ws.getCell('A2').value = 'Company';
    ws.getCell('B2').value = b.name;
    ws.getCell('A3').value = 'Sector';
    ws.getCell('B3').value = b.sector;
    ws.getCell('A4').value = 'asOf';
    ws.getCell('B4').value = asOf;
    ws.getCell('A5').value = 'modelVersion';
    ws.getCell('B5').value = weights.version;
    ws.getCell('A6').value = 'lastClose';
    ws.getCell('B6').value = b.lastClose;
    ws.getCell('B6').numFmt = '$#,##0.00';
    for (const r of [1, 2, 3, 4, 5, 6]) {
      ws.getCell(`A${r}`).font = { bold: true };
    }

    const headerRow = 8;
    const headers = [
      'Horizon',
      'Target date',
      'Predicted close (yHat)',
      'Band low 80%',
      'Band high 80%',
      'Direction',
      'Confidence',
      'Actual close',
      'Error %',
      'Actual date note',
    ];
    headers.forEach((h, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = h;
    });
    styleHeaderRow(ws.getRow(headerRow));

    const byHorizon = new Map(b.forecasts.map((f) => [f.horizon, f]));
    let dataRow = headerRow + 1;
    for (const h of FORECAST_HORIZONS) {
      const f = byHorizon.get(h);
      if (!f) continue;
      const target = toUtcDateString(addTradingDays(asOf, HORIZON_DAYS[h]));
      ws.getCell(dataRow, 1).value = h;
      ws.getCell(dataRow, 2).value = target;
      ws.getCell(dataRow, 3).value = f.yHat;
      ws.getCell(dataRow, 4).value = f.lo80;
      ws.getCell(dataRow, 5).value = f.hi80;
      ws.getCell(dataRow, 6).value = f.direction;
      ws.getCell(dataRow, 7).value = f.confidence;
      ws.getCell(dataRow, 8).value = null; // Actual close — fill later
      // Error % = (Actual - Pred) / Pred when Actual present
      ws.getCell(dataRow, 9).value = {
        formula: `IF(OR(H${dataRow}="",C${dataRow}=0),"",(H${dataRow}-C${dataRow})/C${dataRow})`,
      };
      ws.getCell(dataRow, 10).value = ''; // optional actual date note

      for (const c of [3, 4, 5, 8]) {
        ws.getCell(dataRow, c).numFmt = '$#,##0.00';
      }
      ws.getCell(dataRow, 7).numFmt = '0.0%';
      ws.getCell(dataRow, 9).numFmt = '0.00%';
      dataRow++;
    }

    const explStart = dataRow + 2;
    ws.getCell(explStart, 1).value = 'Explanation';
    ws.getCell(explStart, 1).font = { bold: true, size: 12, color: { argb: 'FF1F4E79' } };
    ws.mergeCells(explStart + 1, 1, explStart + 4, 10);
    const explCell = ws.getCell(explStart + 1, 1);
    explCell.value = `${b.rationale}\n\n${b.mediaNote}${
      b.evidenceUrls.length
        ? `\nEvidence: ${b.evidenceUrls.slice(0, 6).join(' | ')}`
        : '\nEvidence: (none captured)'
    }`;
    explCell.alignment = { wrapText: true, vertical: 'top' };

    ws.getCell(explStart + 6, 1).value =
      'Fill Actual close (col H) after each Target date session closes. Error % auto-fills. Designed for end-of-next-week ingest → resolve → train.';
    ws.getCell(explStart + 6, 1).font = { italic: true, color: { argb: 'FF666666' } };
  }

  // failed symbols note on summary already

  mkdirSync(dirname(args.out), { recursive: true });
  await wb.xlsx.writeFile(args.out);
  console.log(`Wrote ${args.out}`);

  const readme = `# Forecast export — 50 stocks (D1–D5 closes)

## Files

- Workbook: [\`forecast-50-stocks-d1d5.xlsx\`](./forecast-50-stocks-d1d5.xlsx)
- Generator: \`scripts/export-forecast-workbook.ts\` in [OpenStock](https://github.com/nitishberi/OpenStock)

## Run metadata

| Field | Value |
|-------|-------|
| **asOf** | \`${asOf}\` |
| **modelVersion** | \`${weights.version}\` |
| **weights source** | \`${weightSource}\` |
| **sample seed** | \`${args.seed}\` |
| **count** | \`${picked.length}\` (\`${okBundles.length}\` succeeded) |
| **liveMedia** | \`${args.liveMedia}\` |
| **generatedAt (UTC)** | \`${new Date().toISOString()}\` |

## Symbol list (seed ${args.seed})

\`\`\`
${picked.map((s) => s.symbol).join(', ')}
\`\`\`

## Sheet layout

1. **\`_Summary\`** (first) — all tickers, last close, D1–D5 yHat, D1 direction/confidence, sheet link/note.
2. **\`_Instructions\`** — how to fill actuals and re-ingest next week.
3. **One sheet per ticker** (sheet name = symbol) with:
   - Meta: symbol, company, sector, asOf, modelVersion, lastClose
   - Rows D1 / D2 / D3 / D5: Target date (NYSE calendar), Predicted close, Band low/high 80%, Direction, Confidence, **Actual close** (blank), **Error %** formula, optional Actual date note
   - Explanation block (baseline / Gemini rationale + media summary)

## How to fill actuals

After each horizon’s **Target date** session closes (through end of next week for D5):

1. Open the ticker sheet.
2. Enter the official closing price in **Actual close** (column H).
3. Leave **Error %** alone — it computes \`(Actual − Predicted) / Predicted\` when Actual is present.
4. Optionally record a differing print date in **Actual date note**.

## Re-ingest / training plan (end of next week)

1. Complete Actual close for all successful tickers × horizons D1–D5.
2. Resolve in-app (\`resolveDueForecastsAction\` / Forecast Lab) **or** parse this workbook and upsert \`PriceForecast\` rows with \`status: resolved\`, \`actualClose\`, error fields.
3. Run \`trainFromRows\` / Lab **Train** against the resolved cohort + prior strategy-test rows; promote only if the holdout gate passes (prefer keeping \`swing-baseline-v2\` lineage).
4. Archive a copy of the filled workbook under \`docs/exports/\` with a dated name before the next cohort export.

## Notes

- Product target is **closing prices**, not live trading (\`ALPACA_ALLOW_LIVE=false\`).
- If this worker lacked Mongo \`swing-baseline-v2\`, the workbook records the weights source used above.
`;

  writeFileSync(args.readme, readme, 'utf8');
  console.log(`Wrote ${args.readme}`);

  // Machine-readable sidecar for the coordinator
  const metaPath = resolve(dirname(args.out), 'forecast-50-stocks-meta.json');
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        asOf,
        modelVersion: weights.version,
        weightSource,
        seed: args.seed,
        symbols: picked.map((s) => s.symbol),
        succeeded: okBundles.map((b) => b.symbol),
        failed: bundles.filter((b) => b.error).map((b) => ({ symbol: b.symbol, error: b.error })),
        out: args.out,
        liveMedia: args.liveMedia,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`Wrote ${metaPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
