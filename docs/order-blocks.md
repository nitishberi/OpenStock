# Order Blocks (OpenStock)

Clean-room feature inspired by the public OrderBlock.com workflow (bullish/bearish boards + zones), rebuilt for this fork’s **US 100-stock swing universe** and **daily** bars.

## Use

- App route: `/order-blocks` (sidebar **Order Blocks**)
- Deep link: `/order-blocks?symbol=AAPL`
- Server action: `getOrderBlockBoardAction`

## How it scores

- **Strength** ≈ one-directional move from the session open ÷ ATR(20), with a choppy-day penalty when the close gives back most of the excursion (same *shape* as OrderBlock’s disclosed “move from open / normal daily range”, not their code).
- **Order block** = last opposite candle before a structure-breaking impulse (public ICT definition).
- **Liquidity** = recent swing high/low in the trade direction (no options OI).

## Out of scope

Indian F&O universe, OI, INR billing, journal, community, minute refresh.

## Tests

```bash
npx vitest run __tests__/orderblock/engine.test.ts
```
