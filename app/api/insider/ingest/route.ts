import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/database/mongoose';
import { InsiderFiling } from '@/database/models/insider-filing.model';

/**
 * Ingest endpoint for the Scrapling worker (WEB_INSIDER_INGEST_URL).
 * Auth: X-Worker-Token / Bearer must match SCRAPLING_WORKER_TOKEN when set.
 * Upserts on (ticker, filingDate, insiderName, tradeDate, qty, valueUsd).
 */
export async function POST(req: NextRequest) {
  const expected = process.env.SCRAPLING_WORKER_TOKEN;
  if (expected) {
    const header =
      req.headers.get('x-worker-token') ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (header !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const body = await req.json();
  const filings = body?.filings;
  if (!Array.isArray(filings)) {
    return NextResponse.json({ error: 'filings[] required' }, { status: 400 });
  }

  await connectToDatabase();
  let upserted = 0;
  let skipped = 0;
  const tickers = new Set<string>();

  for (const f of filings) {
    const ticker = String(f?.ticker || '')
      .trim()
      .toUpperCase();
    const filingDate = String(f?.filingDate || '').slice(0, 10);
    const tradeDate = String(f?.tradeDate || '').slice(0, 10);
    const insiderName = String(f?.insiderName ?? '');
    if (!ticker || !filingDate || !tradeDate) {
      skipped++;
      continue;
    }

    const qtyNum = f?.qty == null ? NaN : Number(f.qty);
    const valueNum = f?.valueUsd == null ? NaN : Number(f.valueUsd);
    const qty = Number.isFinite(qtyNum) ? qtyNum : null;
    const valueUsd = Number.isFinite(valueNum) ? valueNum : null;

    await InsiderFiling.findOneAndUpdate(
      {
        ticker,
        filingDate,
        insiderName,
        tradeDate,
        qty,
        valueUsd,
      },
      {
        $set: {
          ticker,
          filingDate,
          tradeDate,
          insiderName,
          companyName: f.companyName,
          title: f.title,
          tradeType: String(f.tradeType || '')
            .trim()
            .toUpperCase()
            .slice(0, 1),
          price: f.price == null ? undefined : Number(f.price),
          qty,
          owned: f.owned == null ? undefined : Number(f.owned),
          deltaOwnPct: f.deltaOwnPct == null ? undefined : Number(f.deltaOwnPct),
          valueUsd,
          flags: {
            amended: Boolean(f.flags?.amended),
            multiDay: Boolean(f.flags?.multiDay),
            cluster: Boolean(f.flags?.cluster),
            ceoCfo: Boolean(f.flags?.ceoCfo),
          },
          insCount: f.insCount == null ? undefined : Number(f.insCount),
          sourceUrl: String(f.sourceUrl || `http://www.openinsider.com/${ticker}`),
          sourceList: ['cluster-buys', 'purchases-25k', 'ticker'].includes(f.sourceList)
            ? f.sourceList
            : 'ticker',
          ingestedAt: f.ingestedAt ? new Date(f.ingestedAt) : new Date(),
        },
      },
      { upsert: true }
    );
    upserted++;
    tickers.add(ticker);
  }

  return NextResponse.json({
    ok: true,
    upserted,
    skipped,
    tickers: [...tickers],
  });
}
