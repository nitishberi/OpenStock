# Continue here (repo mirror)

Project Context store is canonical: see Auto Day Trader Project `docs/CONTINUE_HERE.md`.

## Prediction stack (this repo)

- Swing D1–D5 forecasts: `/forecasts`, Lab `/forecasts/lab`
- Channels: **news / social / press / insider** (OpenInsider Form 4 via Scrapling)
- Trading UI off by default (`TRADING_UI_ENABLED=false`)

## Smoke

```bash
npm test
cd services/scrapling-worker && python3 -m unittest test_openinsider -v
npm run strategy-test:smoke
npm run dev
```

Insider ingest: Scrapling `POST /openinsider/scan` → Next `POST /api/insider/ingest` (worker token).
Inngest: `insider-scan-daily`, `insider-scan-midday`.
