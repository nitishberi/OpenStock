# Auto Day Trader Scrapling Worker

Fetches full article HTML after news **discovery** (Tavily / Brave / SerpAPI) in the web app,
and scrapes **OpenInsider** Form 4 HTML tables (cluster buys, $25k purchases, per-ticker).

## Endpoints

- `GET /health` — liveness
- `GET /sources` — allowlist + RSS config
- `POST /fetch` — `{ urls, symbol?, source_kind? }` → MediaDocument payloads
- `POST /ingest` — `{ symbol, articles[] }` discover metadata → fetch bodies
- `POST /rss` — crawl configured public RSS feeds
- `POST /openinsider/scan` — scrape list/ticker pages → InsiderFiling payloads (+ optional ingest)
- `POST /openinsider/parse` — parse provided HTML (fixtures/tests; no network)

## Env

| Variable | Description |
|----------|-------------|
| `SCRAPLING_WORKER_TOKEN` | Shared secret (`Authorization: Bearer` or `X-Worker-Token`) |
| `SOURCES_CONFIG` | Path to `sources.yaml` |
| `SCRAPE_RATE_LIMIT_SECONDS` | Per-domain throttle (default 2) |
| `SCRAPLING_STEALTH` | `true` to use StealthyFetcher |
| `MONGODB_URI` | Optional direct Mongo upsert |
| `WEB_INGEST_URL` | Optional POST back to Next.js media ingest API |
| `WEB_INSIDER_INGEST_URL` | Optional POST to Next.js `/api/insider/ingest` |
| `OPENINSIDER_LIST_CACHE_SECONDS` | Full-list scrape cache (default 900) |

## Tests

```bash
python3 -m unittest test_openinsider -v
```

## Respect

- Domain allowlist only (includes `openinsider.com`)
- No login / credential stuffing
- Prefer RSS and public pages
- Polite rate limits on OpenInsider list scrapes
