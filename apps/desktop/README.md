# AutoDayTrader desktop runtime

Self-contained **Hono + Vite + SQLite** app for the macOS `.app` / `.dmg` ship.

## Dev (Linux or Mac)

```bash
cd apps/desktop
npm install
# optional: copy API keys into file-backend via Settings after start
export AUTODAYTRADER_DATA_DIR=/tmp/autodaytrader-dev
export SCRAPLING_WORKER_TOKEN=dev-token
export SCRAPLING_WORKER_TOKEN_REQUIRED=false   # Linux unit smoke only
export ADMIN_EMAILS=you@example.com
npm run dev          # API http://127.0.0.1:8787
npm run dev:ui       # Vite http://127.0.0.1:5173 (proxies /api)
npm test
```

## Security defaults

| Control | Default |
|--------|---------|
| Bind | `127.0.0.1` |
| `TRADING_UI_ENABLED` | `false` |
| `ALPACA_ALLOW_LIVE` | `false` |
| Secrets | macOS Keychain; file backend (`mode 600`) on Linux |
| Worker ingest | token required when `SCRAPLING_WORKER_TOKEN_REQUIRED=true` |
| Lab promote | admin RBAC (`role=admin` or `ADMIN_EMAILS`) |
| Password | server-side complexity + login rate limit |

## Packaging

See `scripts/macos/README.md` and Project store `docs/macos-dmg-build.md`.

## Python / Scrapling in the bundle

See `resources/PYTHON_VENDOR.md`. Host spawns localhost uvicorn with shared token.
