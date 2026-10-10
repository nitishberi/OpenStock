# macOS DMG host smoke results

**Host:** Nitish Mac (darwin arm64)  
**Completed:** 2026-10-10 00:47:43 PDT (2026-10-10 07:47:43 UTC)  
**Repo / branch:** https://github.com/nitishberi/OpenStock `cursor/macos-dmg-autodaytrader-cee4` @ `758343f` (+ host assemble PATH fix)  
**PR:** https://github.com/nitishberi/OpenStock/pull/9  
**Local clone:** `/Volumes/MacOSX/OpenStock-work/OpenStock`

## DMG path

`/Volumes/MacOSX/OpenStock-work/OpenStock/dist/macos/AutoDayTrader.dmg` (50M ULMO)  
Also installed for smoke: `/Applications/AutoDayTrader.app`  
Build tree app: `/Volumes/MacOSX/OpenStock-work/OpenStock/dist/macos/AutoDayTrader.app` (276M with production `node_modules` + vendored Node 22.14.0)

## Notarization status

**Blocked / not run.** No Developer ID Application identity in Keychain; no `notarytool` Keychain profile.  
Local build used **ad-hoc** codesign (`codesign --force --deep -s -`).  
`spctl --assess` → **rejected** (expected for ad-hoc).

Team ID (Apple Development / App Store profiles): `MBUG59A8NA`

### Exact CLI to finish notarization (do not store secrets in git)

```bash
# 1) Create/install Developer ID Application cert for team MBUG59A8NA, then:
security find-identity -v -p codesigning | grep "Developer ID Application"

# 2) Store credentials once (app-specific password from appleid.apple.com):
xcrun notarytool store-credentials "autodaytrader-notary" \
  --apple-id "<APPLE_ID_EMAIL>" \
  --team-id "MBUG59A8NA" \
  --password "<APP_SPECIFIC_PASSWORD>"

# 3) Re-sign + notarize + staple (from repo root after assemble + create-dmg):
export APPLE_TEAM_ID=MBUG59A8NA
export CODESIGN_IDENTITY="Developer ID Application: <NAME> (MBUG59A8NA)"
export NOTARYTOOL_KEYCHAIN_PROFILE=autodaytrader-notary
./scripts/macos/codesign-notarize.sh

# 4) Verify Gatekeeper:
spctl --assess --type open --context context:primary-signature -v dist/macos/AutoDayTrader.dmg
```

## Smoke pass/fail table

| Check | Result | Notes |
|-------|--------|-------|
| Branch checkout | **PASS** | `758343f` |
| `vendor-runtimes.sh` (Node 22.14 arm64) | **PASS** | Python stub docs only |
| `assemble-app.sh` | **PASS** | Required PATH=vendored Node 22 (Homebrew Node 26 breaks better-sqlite3) |
| Prefetch prod `node_modules` into app | **PASS** | Host step; lockfile copy added to assemble script |
| Ad-hoc codesign | **PASS** | `Signature=adhoc` |
| `create-dmg.sh` | **PASS** | 50M at path above |
| Developer ID + notarize + staple | **FAIL / blocked** | Cert + notary profile missing |
| Gatekeeper accepts notarized app | **FAIL** | `spctl` rejected (ad-hoc) |
| LaunchAgent install | **PASS** | `~/Library/LaunchAgents/com.autodaytrader.agent.plist` |
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
| Scrapling worker | **N/A / gated** | token required — worker not started (expected) |

## LaunchAgent verification

```
Label: com.autodaytrader.agent
Program: /Applications/AutoDayTrader.app/Contents/MacOS/AutoDayTrader
KeepAlive: true
RunAtLoad: true
HOST=127.0.0.1 PORT=8787
TRADING_UI_ENABLED=false ALPACA_ALLOW_LIVE=false
Logs: ~/Library/Application Support/AutoDayTrader/logs/
```

## Build notes

1. Run `./scripts/macos/vendor-runtimes.sh` **before** assemble so Node 22 is on PATH (script now prefers `dist/macos/vendor/node/bin`).
2. Zero Homebrew requirement for the *installed* app (vendored Node inside `.app`); build machine used existing curl/hdiutil/codesign.
3. No live trading; no secrets committed.

## Poll history (pre-branch)

| Time (PDT) | Result |
|------------|--------|
| 00:34–00:39 | Waiting; branch 404 |
| 00:42 | Branch live; packaging started |

