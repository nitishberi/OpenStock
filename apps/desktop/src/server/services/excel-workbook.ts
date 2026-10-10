/**
 * Excel export/import for desktop SQLite forecasts (training Actuals loop).
 */

import ExcelJS from 'exceljs';
import { getDb, nowIso } from '../db/index.js';

export async function exportForecastWorkbook(opts?: {
  symbols?: string[];
}): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
  const db = getDb();
  let sql = `SELECT symbol, asOf, horizon, modelVersion, lastClose, yHat, lo80, hi80, direction, confidence, rationale, actualClose
             FROM price_forecast WHERE 1=1`;
  const params: string[] = [];
  if (opts?.symbols?.length) {
    sql += ` AND symbol IN (${opts.symbols.map(() => '?').join(',')})`;
    params.push(...opts.symbols.map((s) => s.toUpperCase()));
  }
  sql += ` ORDER BY symbol, asOf, horizon`;
  const rows = db.prepare(sql).all(...params) as Array<{
    symbol: string;
    asOf: string;
    horizon: string;
    modelVersion: string;
    lastClose: number;
    yHat: number;
    lo80: number;
    hi80: number;
    direction: string;
    confidence: number;
    rationale: string | null;
    actualClose: number | null;
  }>;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'AutoDayTrader';
  const sheet = wb.addWorksheet('Forecasts');
  sheet.columns = [
    { header: 'symbol', key: 'symbol', width: 10 },
    { header: 'asOf', key: 'asOf', width: 12 },
    { header: 'horizon', key: 'horizon', width: 8 },
    { header: 'modelVersion', key: 'modelVersion', width: 22 },
    { header: 'lastClose', key: 'lastClose', width: 12 },
    { header: 'yHat', key: 'yHat', width: 12 },
    { header: 'lo80', key: 'lo80', width: 12 },
    { header: 'hi80', key: 'hi80', width: 12 },
    { header: 'direction', key: 'direction', width: 10 },
    { header: 'confidence', key: 'confidence', width: 12 },
    { header: 'Actual close', key: 'actualClose', width: 14 },
    { header: 'rationale', key: 'rationale', width: 40 },
  ];
  for (const r of rows) {
    sheet.addRow({
      ...r,
      actualClose: r.actualClose ?? '',
    });
  }

  const readme = wb.addWorksheet('README');
  readme.getCell('A1').value =
    'Fill "Actual close" for resolved horizons, then Import workbook to update SQLite for training.';
  readme.getCell('A2').value = `Exported ${nowIso()} · ${rows.length} rows`;

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const asOf = rows[0]?.asOf || new Date().toISOString().slice(0, 10);
  return {
    buffer,
    filename: `autodaytrader-forecasts-${asOf}.xlsx`,
    rowCount: rows.length,
  };
}

function cellNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'object' && v && 'result' in (v as object)) {
    const r = Number((v as { result: unknown }).result);
    return Number.isFinite(r) ? r : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function ingestForecastWorkbook(
  buffer: Buffer
): Promise<{ updated: number; skipped: number; errors: string[] }> {
  const wb = new ExcelJS.Workbook();
  // exceljs Buffer typings disagree across Node versions
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet =
    wb.getWorksheet('Forecasts') ||
    wb.worksheets.find((s) => s.name.toLowerCase().includes('forecast')) ||
    wb.worksheets[0];
  if (!sheet) return { updated: 0, skipped: 0, errors: ['No worksheet found'] };

  const headerRow = sheet.getRow(1);
  const headers: Record<string, number> = {};
  headerRow.eachCell((cell, col) => {
    headers[String(cell.value || '').trim().toLowerCase()] = col;
  });

  const col = (...names: string[]) => {
    for (const n of names) {
      if (headers[n] != null) return headers[n];
    }
    return 0;
  };
  const cSymbol = col('symbol');
  const cAsOf = col('asof', 'as of');
  const cHorizon = col('horizon');
  const cModel = col('modelversion', 'model version', 'model');
  const cActual = col('actual close', 'actualclose', 'actual');

  if (!cSymbol || !cAsOf || !cHorizon || !cActual) {
    return {
      updated: 0,
      skipped: 0,
      errors: ['Missing required columns: symbol, asOf, horizon, Actual close'],
    };
  }

  const db = getDb();
  const select = db.prepare(
    `SELECT lastClose, yHat, lo80, hi80, direction, modelVersion FROM price_forecast
     WHERE symbol = ? AND asOf = ? AND horizon = ?`
  );
  const update = db.prepare(
    `UPDATE price_forecast SET
       actualClose = ?, absError = ?, pctError = ?, signedError = ?,
       directionHit = ?, inside80 = ?, status = 'resolved'
     WHERE symbol = ? AND asOf = ? AND horizon = ? AND modelVersion = ?`
  );

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const symbol = String(row.getCell(cSymbol).value || '')
      .trim()
      .toUpperCase();
    const asOf = String(row.getCell(cAsOf).value || '').slice(0, 10);
    const horizon = String(row.getCell(cHorizon).value || '').trim().toUpperCase();
    const modelHint = cModel ? String(row.getCell(cModel).value || '').trim() : '';
    const actual = cellNum(row.getCell(cActual).value);
    if (!symbol || !asOf || !horizon || actual == null) {
      skipped++;
      return;
    }
    try {
      const matches = (
        modelHint
          ? db
              .prepare(
                `SELECT lastClose, yHat, lo80, hi80, direction, modelVersion FROM price_forecast
                 WHERE symbol = ? AND asOf = ? AND horizon = ? AND modelVersion = ?`
              )
              .all(symbol, asOf, horizon, modelHint)
          : select.all(symbol, asOf, horizon)
      ) as Array<{
        lastClose: number;
        yHat: number;
        lo80: number;
        hi80: number;
        direction: string;
        modelVersion: string;
      }>;
      if (!matches.length) {
        skipped++;
        return;
      }
      for (const m of matches) {
        const absError = Math.abs(m.yHat - actual);
        const pctError = m.lastClose > 0 ? absError / m.lastClose : null;
        const signedError = m.yHat - actual;
        let directionHit = 0;
        if (m.direction === 'up' && actual > m.lastClose) directionHit = 1;
        else if (m.direction === 'down' && actual < m.lastClose) directionHit = 1;
        else if (m.direction === 'flat') directionHit = 1;
        const inside80 = actual >= m.lo80 && actual <= m.hi80 ? 1 : 0;
        const info = update.run(
          actual,
          absError,
          pctError,
          signedError,
          directionHit,
          inside80,
          symbol,
          asOf,
          horizon,
          m.modelVersion
        );
        if (info.changes > 0) updated += info.changes;
        else skipped++;
      }
    } catch (e) {
      errors.push(`row ${rowNumber}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  return { updated, skipped, errors: errors.slice(0, 20) };
}
