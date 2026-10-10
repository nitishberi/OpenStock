# macOS DMG host smoke results

**Host:** Nitish Mac (darwin arm64)  
**Completed (CPython/Scrapling vendor pass):** 2026-10-10 00:58:45 PDT (2026-10-10 07:58:45 UTC)  
**Repo / branch:** https://github.com/nitishberi/OpenStock `cursor/macos-dmg-autodaytrader-cee4` @ `3194a2e`  
**PR:** https://github.com/nitishberi/OpenStock/pull/9  
**Local clone:** `/Volumes/MacOSX/OpenStock-work/OpenStock`

## Paths

| Artifact | Path |
|----------|------|
| DMG | `/Volumes/MacOSX/OpenStock-work/OpenStock/dist/macos/AutoDayTrader.dmg` (~86M ULMO after CPython) |
| Build-tree `.app` | `/Volumes/MacOSX/OpenStock-work/OpenStock/dist/macos/AutoDayTrader.app` (~423M) |
| Installed `.app` (smoke) | `/Applications/AutoDayTrader.app` |
| LaunchAgent plist | `~/Library/LaunchAgents/com.autodaytrader.agent.plist` |
| App Support / logs | `~/Library/Application Support/AutoDayTrader/` |

## Signing / notarization

| Item | Status |
|------|--------|
| Codesigning identities | **Only** `Apple Development: Nitish Berri (6X7HN39F3Q)` |
| Developer ID Application | **Missing** — notarization not attempted |
| Team ID | `MBUG59A8NA` |
| Codesign for this DMG | **Ad-hoc** (`codesign --force --deep -s -`) |
| Gatekeeper | **FAIL / rejected** (expected for ad-hoc) |

## Runtime vendoring

| Runtime | Vendored into `.app`? | Notes |
|---------|------------------------|-------|
| Node.js 22.14.0 darwin-arm64 | **YES** | `Contents/Resources/node/` |
| CPython 3.12.15 (PBS `20261009` aarch64 install_only) | **YES** | `Contents/Resources/python/bin/python3` |
| Scrapling + worker pip deps | **YES** | Installed into vendored CPython site-packages (`scrapling==0.4.15`) |
| Scrapling worker sources | **YES** | `Contents/Resources/scrapling-worker/` |
| Scrapling worker process | **YES — running** | `python3 -m uvicorn main:app --host 127.0.0.1 --port 8091` |

## LaunchAgent status

```
Label: com.autodaytrader.agent
Program: /Applications/AutoDayTrader.app/Contents/MacOS/AutoDayTrader
KeepAlive: true
RunAtLoad: true
state: running
HOST=127.0.0.1 PORT=8787
AUTODAYTRADER_SPAWN_WORKER=1
SCRAPLING_WORKER_TOKEN: Keychain AutoDayTrader.api (not in plist)
```

## Smoke pass/fail table

| Check | Result | Notes |
|-------|--------|-------|
| `vendor-runtimes.sh` Node + CPython + pip | **PASS** | PBS 20261009 / cpython-3.12.15 aarch64 |
| `assemble-app.sh` + `create-dmg.sh` | **PASS** | ad-hoc signed |
| `python3 -c "import scrapling"` in app Resources | **PASS** | 0.4.15 |
| Worker starts with Keychain token | **PASS** | listens `127.0.0.1:8091` |
| `GET http://127.0.0.1:8091/docs` | **PASS** | http 200 |
| Health `127.0.0.1:8787` | **PASS** | secretsBackend=keychain |
| Forecasts / Lab / auth (prior) | **PASS** | unchanged host checks |
| Developer ID notarize | **FAIL / blocked** | cert still missing |
| Gatekeeper notarized | **FAIL** | ad-hoc |

## Build notes

1. `./scripts/macos/vendor-runtimes.sh` now downloads PBS CPython and `pip install -r services/scrapling-worker/requirements.txt`.
2. Worker token must come from Keychain / env at runtime — never baked into the DMG.
3. No live trading; no secrets committed.

