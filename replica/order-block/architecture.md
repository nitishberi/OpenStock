# Architecture: OpenStock Order Blocks (rebuild of OrderBlock.com core loop)

## Stack

| layer | choice | why |
| --- | --- | --- |
| web | Existing Next.js OpenStock app | Already the product shell |
| scoring | `lib/orderblock/engine.ts` (pure TS) | Deterministic, unit-tested, no third-party API |
| bars | Existing `lib/forecast/bars.ts` | Finnhub → Alpaca → Yahoo |
| universe | `config/forecast-universe-100.json` | Same 100 US names as Forecasts/Lab |
| auth | Existing Better Auth session | No new identity system |
| persistence | In-memory board cache 15m | Vertical slice; no new Mongo collection required |
| jobs | On-demand refresh | Minute cron not needed for daily-bar swing view |

## Schema

No new tables in v1. Board is computed. Optional later:

```sql
-- future: persist snapshots for Lab attribution
-- order_block_snapshot(as_of date, payload jsonb, created_at timestamptz)
```

## API

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| server action `getOrderBlockBoardAction` | build bullish/bearish boards + zones | signed-in user | force?, limitSymbols? | OrderBlockBoard | F01 |
| `GET /order-blocks` | page | signed-in | ?symbol= | UI | F01/F02 |

## The parts that bite

- **Bar latency:** 100 symbols × rate limits — cache 15m, delayMs tunable
- **Daily vs minute:** original is intraday IST; we score the latest daily session for swing research
- **No OI:** liquidity is swing high/low, not options open interest
- **Not advice:** disclaimer on every board

## Build order

1. Vertical slice: engine + board + `/order-blocks` + sidebar — **done**
2. Must-haves: picks, zones, breadth, sector flow — **done**
3. Should: Forecasts deep-link `?symbol=` — **done**
4. Later: persist snapshots, wire strength into forecast features

Next: `/replica-design` optional (OpenStock tokens already applied); then ship PR.
