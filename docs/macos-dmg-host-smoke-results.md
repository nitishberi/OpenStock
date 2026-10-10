# macOS DMG host smoke results

**Host:** Nitish Mac (darwin arm64)  
**SPA fix completed:** 2026-10-10 01:34:14 PDT (2026-10-10 08:34:14 UTC)  
**Repo / branch:** https://github.com/nitishberi/OpenStock `cursor/macos-dmg-autodaytrader-cee4`  
**PR:** https://github.com/nitishberi/OpenStock/pull/9  

## Root cause (SPA stub)

Hono `app.ts` only looked for `cwd/dist/client` (or `client-dist`).  
`assemble-app.sh` copied Vite output to `Resources/app/client/` instead.  
With launcher `cd Resources/app`, `index.html` was present but **not** where the server looked → API stub page.

Secondary issue: user-installed DMG lacked baked `node_modules`; LaunchAgent PATH has no Homebrew `npm` → exit 127 on first-run install.

## Fixes

1. `app.ts` accepts `dist/client`, `client`, `client-dist`.
2. `assemble-app.sh` copies UI to **`Resources/app/dist/client/`** (plus legacy `client/`), fails if UI missing, bakes production `node_modules`.
3. Launcher uses bundled `Resources/node/bin/npm` when deps missing.
4. README first-run notes SPA expectation.

## Paths

| Artifact | Path |
|----------|------|
| DMG | `/Volumes/MacOSX/OpenStock-work/OpenStock/dist/macos/AutoDayTrader.dmg` (~87M) |
| Installed app | `/Applications/AutoDayTrader.app` |
| SPA in app | `.../Resources/app/dist/client/index.html` (+ legacy `.../client/`) |

## Smoke (post-SPA fix)

| Check | Result | Notes |
|-------|--------|-------|
| `GET /` HTML title | **PASS** | `<title>AutoDayTrader</title>` |
| Not API stub | **PASS** | no “Build UI with npm run build:ui” |
| `#root` present | **PASS** | |
| `/assets/*.js` | **PASS** | http 200; bundle contains `Forecasts` |
| `/api/health` | **PASS** | 127.0.0.1:8787 |
| LaunchAgent KeepAlive | **PASS** | running |
| Scrapling worker :8091 | **PASS** | with Keychain token |
| CPython + `import scrapling` | **PASS** | 0.4.15 |
| Developer ID / notarize | **FAIL / blocked** | Apple Development only |
| Gatekeeper | **FAIL** | ad-hoc |

## Confirmation curl

```text
$ curl -s http://127.0.0.1:8787/ | grep -E '<title>|id="root"|Build UI'
<title>AutoDayTrader</title>
    <div id="root"></div>
```

