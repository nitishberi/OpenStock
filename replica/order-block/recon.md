# Recon map: OrderBlock (web) → OpenStock feature

Scope: Bullish/Bearish ranked boards + order-block/liquidity zones on a symbol chart. Adapted for Auto Day Trader’s **US ~100 liquid stocks** and **swing (daily)** bars — not Indian F&O minute boards, not their paywall/auth/journal/community.
For: OpenStock / Auto Day Trader users shortlisting names with structure context next to D1–D5 forecasts
Date: 2026-10-10

## Sources (public only)

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | marketing home | https://order-block.com/ | boards sample, zone callouts, FAQ |
| 2 | about | https://order-block.com/about | strength formula disclosed: move from open ÷ normal daily move |
| 3 | playbook | https://order-block.com/blog/orderblock-daily-playbook | 5-step flow, picks rules, Z/S1/R1 |
| 4 | updates | https://order-block.com/updates | terminal features v1–v2.9 |
| 5 | terms | https://order-block.com/terms | Google/guest auth, INR plans — skip for clone |

No member login. No private API. No JS reverse-engineering.

## Core loop

Read market breadth → pick bullish or bearish side → shortlist from ranked board → open a symbol’s order-block + liquidity zones → use as research context (not a trade tip).

## Screens (original → OpenStock)

| ID | original | OpenStock route | purpose |
| --- | --- | --- | --- |
| S01 | Home / top picks | `/order-blocks` | Day’s strongest bullish/bearish names |
| S02 | Bullish + Bearish boards | `/order-blocks` dual columns | Ranked strength list |
| S03 | Market picture / breadth | `/order-blocks` header strip | Counts + sector leaders |
| S04 | Symbol popup chart + zones | `/order-blocks` detail panel | OB range, Z, invalidation, liquidity |
| S05 | Sector flow | `/order-blocks` sector list | Avg strength by sector |
| S06 | Auth / billing / journal / community | — | **skip** |

## Flows

```
F01 Morning shortlist
    S03 breadth -> choose side -> S02 board -> S04 zones
    happy path clicks: 3
    edge: holiday / empty bars / choppy (strength 0)

F02 Inspect one name from Forecasts
    Forecasts row -> /order-blocks?symbol=XYZ -> S04
    happy path clicks: 2
```

## Components

Dual ranked lists, strength %, sector chip, market breadth counts, zone price stack (Resistance / Order Block / Support / Liquidity), symbol detail sheet, refresh control, disclaimer.

## Inferred data model (adapted)

```
BoardSnapshot  asOf, bullishCount, bearishCount, leadSector, lagSector
BoardRow       symbol, side, rank, strength, pctChange, sector, isPick, ruleNote
ZoneSet        orderBlockLow/High, zoneZ, invalidation, liquidity, resistance, support
```

## Out of scope

- Their Indian F&O universe, OI feed, INR billing, WhatsApp guest login
- Trading journal, learning videos, community
- Minute refresh engine (we use daily bars + on-demand refresh)
- Copying their UI skin/branding

## Size

Screens 5 in-product, flows 2, entities 3. Hard parts: bar fetch latency for 100 names, honest OB detection on daily bars, not overclaiming “institutional”. Size: **S–M**.
