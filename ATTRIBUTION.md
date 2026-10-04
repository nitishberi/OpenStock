# Attribution

## OpenStock (AGPL-3.0)

This project is a fork of [OpenStock](https://github.com/Open-Dev-Society/OpenStock) by **Open Dev Society**.

- License: GNU Affero General Public License v3.0 (`LICENSE`)
- Downstream modifications and network deployments must remain AGPL-3.0 and credit Open Dev Society.

## daily_stock_analysis (MIT)

Decision-dashboard field shape (action, score, trend, entry/exit levels, risk alerts, catalysts, checklist), multi-source news discovery, market review, and multi-channel notification patterns are adapted from [daily_stock_analysis](https://github.com/ZhuLinsen/daily_stock_analysis) by **ZhuLinsen** (MIT License).

We did **not** replace the OpenStock UI with DSA’s FastAPI WebUI. Strategy lenses in v1 are a short checklist inspired by DSA’s agent strategies; the full 15-strategy chat is out of scope.

## Scrapling

Article HTML fetch/extract uses [Scrapling](https://github.com/D4Vinci/Scrapling) in `services/scrapling-worker/`.
