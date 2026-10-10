# Mac mini — build, sign, notarize AutoDayTrader.dmg

Run these on an Apple Silicon Mac with Xcode CLT and a Developer ID certificate.

## Prerequisites

- Branch: `cursor/macos-dmg-autodaytrader-cee4` (or the DMG PR branch)
- Node 22+ for local `npm ci` during assemble (vendored Node is also downloaded)
- Env for notarization (never commit):

```bash
export APPLE_TEAM_ID=XXXXXXXXXX
export APPLE_ID=you@example.com
export APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
# or: export NOTARYTOOL_KEYCHAIN_PROFILE=autodaytrader-notary
export CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
```

## Build sequence

```bash
git clone https://github.com/nitishberi/OpenStock.git
cd OpenStock
git checkout cursor/macos-dmg-autodaytrader-cee4

./scripts/macos/vendor-runtimes.sh          # Node 22 + CPython aarch64 + Scrapling
./scripts/macos/assemble-app.sh             # builds Vite UI → Resources/app/dist/client + server
./scripts/macos/create-dmg.sh               # → dist/macos/AutoDayTrader.dmg
./scripts/macos/codesign-notarize.sh        # sign + notarytool + staple
```

`assemble-app.sh` runs `npm run build:ui` and **requires** `apps/desktop/dist/client/index.html`.
The Hono host serves that folder from `Resources/app` (cwd). If you only see the
“API up… Build UI…” stub page, the SPA was not packaged — rebuild with assemble.

## First run on clean Mac

1. Open DMG → drag `AutoDayTrader.app` to Applications.
2. Launch once (Gatekeeper should accept notarized build). Open `http://127.0.0.1:8787` — you should see the **Forecasts SPA** (`<title>AutoDayTrader</title>`), not the API stub.
3. Settings → paste Finnhub / Gemini / Tavily / worker token (Keychain).
4. Optional 24/7:

```bash
./scripts/macos/first-run-install-launchd.sh
# or from app Resources after install
```

5. Smoke: `curl -s http://127.0.0.1:8787/ | grep -q 'id="root"'` and `/api/health` — see
   `docs/macos-dmg-host-smoke-results.md`.

## Safety defaults

- Binds `127.0.0.1` only
- `TRADING_UI_ENABLED=false`
- `ALPACA_ALLOW_LIVE=false`
- Scrapling worker token required in production mode
