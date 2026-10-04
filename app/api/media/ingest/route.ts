import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/database/mongoose';
import { MediaDocument } from '@/database/models/media-document.model';

/**
 * Optional ingest endpoint for the Scrapling worker (WEB_INGEST_URL).
 * Auth: X-Worker-Token / Bearer must match SCRAPLING_WORKER_TOKEN when set.
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
  const documents = body?.documents;
  if (!Array.isArray(documents)) {
    return NextResponse.json({ error: 'documents[] required' }, { status: 400 });
  }

  await connectToDatabase();
  let upserted = 0;
  for (const doc of documents) {
    if (!doc?.url) continue;
    await MediaDocument.findOneAndUpdate(
      { url: doc.url },
      {
        $set: {
          symbol: doc.symbol,
          title: doc.title,
          source: doc.source,
          sourceKind: doc.sourceKind || 'manual',
          excerpt: doc.excerpt,
          body: doc.body,
          publishedAt: doc.publishedAt ? new Date(doc.publishedAt) : undefined,
          fetchedAt: doc.fetchedAt ? new Date(doc.fetchedAt) : new Date(),
          domain: doc.domain || 'unknown',
          score: doc.score,
          tags: doc.tags || ['scrapling'],
        },
      },
      { upsert: true }
    );
    upserted++;
  }

  return NextResponse.json({ ok: true, upserted });
}
