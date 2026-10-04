# Auto Day Trader Scrapling Worker

Fetches full article HTML after news **discovery** (Tavily / Brave / SerpAPI) in the web app.

## Endpoints

- `GET /health` — liveness
- `GET /sources` — allowlist + RSS config
- `POST /fetch` — `{ urls, symbol?, source_kind? }` → MediaDocument payloads
- `POST /ingest` — `{ symbol, articles[] }` discover metadata → fetch bodies
- `POST /rss` — crawl configured public RSS feeds

## Env

| Variable | Description |
|----------|-------------|
| `SCRAPLING_WORKER_TOKEN` | Shared secret (`Authorization: Bearer` or `X-Worker-Token`) |
| `SOURCES_CONFIG` | Path to `sources.yaml` |
| `SCRAPE_RATE_LIMIT_SECONDS` | Per-domain throttle (default 2) |
| `SCRAPLING_STEALTH` | `true` to use StealthyFetcher |
| `MONGODB_URI` | Optional direct Mongo upsert |
| `WEB_INGEST_URL` | Optional POST back to Next.js ingest API |

## Respect

- Domain allowlist only
- No login / credential stuffing
- Prefer RSS and public pages
