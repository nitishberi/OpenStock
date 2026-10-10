# Desktop DMG — forecasts, Excel, OpenInsider, notifications

Branch: `cursor/macos-dmg-autodaytrader-cee4` (PR #9).

## Forecast universes

`POST /api/forecasts/run` accepts:

| mode | meaning |
|------|---------|
| `watchlist` | User watchlist (default) |
| `custom` | `symbols[]` any tickers |
| `random` | Sample N from the 100-stock universe (`count`, optional `seed`) |
| `universe` | Full 100 |

Cap: `maxSymbols` ≤ 100 (hard 20-symbol limit removed).

## Excel training loop

- `GET /api/forecasts/export.xlsx` — export SQLite forecasts with blank **Actual close**
- `POST /api/forecasts/import` — multipart `file` .xlsx; fills `actualClose` + error metrics for train/promote

UI: Forecasts page **Export Excel** / **Import Excel**.

## OpenInsider

- Nav **OpenInsider** → `/insider`
- `GET /api/insider/filings`, `POST /api/insider/scan` → Scrapling worker
- Scheduler every **6h** (+ boot delay) when `AUTODAYTRADER_SCHEDULER≠0`

## Notifications

Types in Settings: `forecast_refresh`, `form4_material`, `form4_heavy`, `volume_uptick`, `insider_scan`, `test`.

Each has enabled flag, channels (`macos|email|telegram|discord`), optional threshold.

Smart alerts:
- **form4_heavy** — ingest when `|valueUsd|` ≥ threshold (default $250k)
- **volume_uptick** — scheduler every 30m; volume ≥ threshold × 20d average (default 2.5×)
