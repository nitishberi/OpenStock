# Auto Day Trader — what still needs live API keys

Verified in this environment without live secrets:

- TypeScript (`tsc --noEmit`) clean
- Unit tests (pricing engine, analysis clamp, market hours) pass
- Next.js production build succeeds (with local Mongo available)
- Compose files present for `web` + `mongodb` + `scrapling-worker` (Docker not installed on the agent VM)

## Keys / services required for full live testing

| Capability | Env vars | Notes |
|------------|----------|-------|
| Auth + app | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Required to sign in |
| MongoDB | `MONGODB_URI` | Compose provides local |
| Quotes / candles | `NEXT_PUBLIC_FINNHUB_API_KEY` or `FINNHUB_API_KEYS` | Core market data |
| AI decision report | `GEMINI_API_KEY` (or MiniMax/Siray) | Falls back to heuristic draft if missing |
| News discovery | `TAVILY_API_KEY` and/or `BRAVE_API_KEY` / `SERPAPI_API_KEY` | Finnhub company-news used as fallback |
| Scrapling bodies | Worker up + optional `SCRAPLING_WORKER_TOKEN` | Without worker, discovery metadata still stored |
| Alpaca paper | `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, `ALPACA_MODE=paper` | Approve still works but submit fails without keys |
| Email alerts | `NODEMAILER_EMAIL`, `NODEMAILER_PASSWORD` | Optional |
| Telegram | `TELEGRAM_BOT_TOKEN`, chat id | Optional |
| Discord | `DISCORD_WEBHOOK_URL` | Optional |
| Inngest cloud | `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` | Local `npx inngest-cli dev` works without |
| Live trading | `ALPACA_MODE=live` + `ALPACA_ALLOW_LIVE=true` | **Not enabled by default; still needs UI Approve** |

## Explicitly not auto-tested here

- Real Alpaca order round-trip
- Live Scrapling fetches against remote news sites
- Telegram/Discord delivery
- Full market-hours Inngest cron with real watchlists
