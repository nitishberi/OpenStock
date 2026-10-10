# macOS DMG host smoke results

**Host:** Nitish Mac (darwin arm64)  
**Completed:** 2026-10-10 00:47:43 PDT  
**Cert recheck:** 2026-10-10 00:48:48 PDT (2026-10-10 07:48:48 UTC) — still only Apple Development (no Developer ID Application)  
**Repo / branch:** https://github.com/nitishberi/OpenStock `cursor/macos-dmg-autodaytrader-cee4` @ `ce053d5`  
**PR:** https://github.com/nitishberi/OpenStock/pull/9  
**Local clone:** `/Volumes/MacOSX/OpenStock-work/OpenStock`

## Paths

| Artifact | Path |
|----------|------|
| DMG | `/Volumes/MacOSX/OpenStock-work/OpenStock/dist/macos/AutoDayTrader.dmg` (50M ULMO) |
| Build-tree `.app` | `/Volumes/MacOSX/OpenStock-work/OpenStock/dist/macos/AutoDayTrader.app` (~276M; prod `node_modules` + Node 22.14.0) |
| Installed `.app` (smoke) | `/Applications/AutoDayTrader.app` |
| LaunchAgent plist | `~/Library/LaunchAgents/com.autodaytrader.agent.plist` |
| App Support / logs | `~/Library/Application Support/AutoDayTrader/` (`logs/launchd.{out,err}.log`) |

## Signing / notarization

| Item | Status |
|------|--------|
| Codesigning identities | **Only** `Apple Development: Nitish Berri (6X7HN39F3Q)` |
| Developer ID Application | **Missing** (rechecked 2026-10-10 00:48:48 PDT) |
| Team ID | `MBUG59A8NA` |
| `notarytool` Keychain profiles | None (`AC_PASSWORD`, `notarytool`, `OpenStock`, `autodaytrader-notary`) |
| Codesign used for this DMG | **Ad-hoc** (`codesign --force --deep -s -`) → `Signature=adhoc` |
| `./scripts/macos/codesign-notarize.sh` | **Not run** (blocked) |
| Gatekeeper `spctl --assess` | **FAIL / rejected** (expected for ad-hoc) |

### Exact CLI when Developer ID is installed (no secrets in git)

```bash
security find-identity -v -p codesigning | grep "Developer ID Application"

xcrun notarytool store-credentials "autodaytrader-notary" \
  --apple-id "<APPLE_ID_EMAIL>" \
  --team-id "MBUG59A8NA" \
  --password "<APP_SPECIFIC_PASSWORD>"

export APPLE_TEAM_ID=MBUG59A8NA
export CODESIGN_IDENTITY="Developer ID Application: <NAME> (MBUG59A8NA)"
export NOTARYTOOL_KEYCHAIN_PROFILE=autodaytrader-notary
./scripts/macos/codesign-notarize.sh

spctl --assess --type open --context context:primary-signature -v dist/macos/AutoDayTrader.dmg
```

## Runtime vendoring

| Runtime | Vendored into `.app`? | Notes |
|---------|------------------------|-------|
| Node.js 22.14.0 darwin-arm64 | **YES** | `vendor-runtimes.sh` → `Contents/Resources/node/` |
| CPython (python-build-standalone) | **NO** | Only stub `Resources/python/README.md` (no `bin/python3`) |
| Scrapling worker sources | **YES (sources only)** | `Resources/scrapling-worker/` (Dockerfile, main.py, requirements.txt, …) — **no** embedded venv/site-packages |
| Scrapling worker process at smoke | **Not started** | `SCRAPLING_WORKER_TOKEN` required; err log: token required — not starting worker |

## LaunchAgent status

```
Label: com.autodaytrader.agent
Program: /Applications/AutoDayTrader.app/Contents/MacOS/AutoDayTrader
KeepAlive: true
RunAtLoad: true
state: running (pid observed 99014 at smoke time; still running at cert recheck)
HOST=127.0.0.1 PORT=8787
TRADING_UI_ENABLED=false
ALPACA_ALLOW_LIVE=false
AUTODAYTRADER_SPAWN_WORKER=1
```

## Smoke pass/fail table

| Check | Result | Notes |
|-------|--------|-------|
| Branch checkout | **PASS** | tip includes host assemble PATH fix + this doc |
| `vendor-runtimes.sh` (Node 22.14 arm64) | **PASS** | CPython not downloaded (stub README only) |
| `assemble-app.sh` | **PASS** | Prefer vendored Node 22 (Homebrew Node 26 breaks better-sqlite3) |
| Prefetch prod `node_modules` into app | **PASS** | Host step; lockfile copied by assemble |
| Ad-hoc codesign | **PASS** | `Signature=adhoc` |
| `create-dmg.sh` | **PASS** | 50M DMG path above |
| Developer ID + notarize + staple | **FAIL / blocked** | Cert + notary profile missing |
| Gatekeeper accepts notarized app | **FAIL** | `spctl` rejected (ad-hoc) |
| LaunchAgent install | **PASS** | plist path above |
| KeepAlive | **PASS** | `KeepAlive=true`, `state=running` |
| Localhost bind `127.0.0.1:8787` | **PASS** | health.bind |
| `TRADING_UI_ENABLED=false` | **PASS** | |
| `ALPACA_ALLOW_LIVE=false` | **PASS** | |
| Secrets backend Keychain | **PASS** | `secretsBackend":"keychain"`; service prefix `AutoDayTrader.*` |
| `apps/desktop` smoke script | **PASS** | sign-up, watchlist, ingest 401 without token |
| Auth sign-up | **PASS** | http 200 |
| `GET /api/forecasts` | **PASS** | 200 empty list |
| `GET /api/forecasts/model` | **PASS** | stub `swing-baseline-v1-stub` |
| `GET /api/lab` | **PASS** | 200 |
| `POST /api/notify/test` | **PASS** | macos=`sent`; email/telegram/discord skipped (no keys) |
| `GET /api/settings` secrets status | **PASS** | all API keys unset |
| CPython embedded | **FAIL / not vendored** | stub docs only |
| Scrapling sources in app | **PASS** | tree present; no Python runtime to execute worker |
| Scrapling worker live | **N/A / gated** | token required — not started |

## Build notes

1. Run `./scripts/macos/vendor-runtimes.sh` **before** assemble so Node 22 is on PATH.
2. To embed CPython later: follow `apps/desktop/resources/PYTHON_VENDOR.md` / `dist/macos/vendor/python/README.md` (python-build-standalone aarch64), then re-assemble.
3. Zero Homebrew requirement for the *installed* app (vendored Node inside `.app`).
4. No live trading; no secrets committed.

## Poll history (pre-branch)

| Time (PDT) | Result |
|------------|--------|
| 00:34–00:39 | Waiting; branch 404 |
| 00:42 | Branch live; packaging started |
| 00:47 | Smoke complete; ad-hoc DMG |
| 00:48+ | Cert recheck: still Apple Development only |

