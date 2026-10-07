# Attack surface — Auto Day Trader / OpenStock

Inventory of reachable surfaces on `main` (post PR #6). Auth stated as **implemented**, not aspirational.

---

## 1. Public HTTP (no session)

| Surface | Method | Notes |
|---------|--------|--------|
| `/`, `/about`, `/help`, `/terms`, `/api-docs`, `/sponsor` | GET | Marketing; middleware allowlist |
| `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password` | GET + server actions | Public auth UX |
| `/api/auth/*` | GET/POST | Better Auth (`app/api/auth/[...all]/route.ts`); middleware excludes all `/api` |
| Static `/_next/*`, favicon, assets | GET | Matcher exclusions |

---

## 2. API routes

### 2.1 `GET /api/quotes`

**Authz:** Session required (`getSession`).  
**Input:** `symbols` query — split, uppercased, regex `^[A-Z0-9.:\-]{1,20}$`, max 25.  
**Backend:** Finnhub via `getLiveQuotes`.  
**Finding — Recommendation:** Good pattern; extend to other market-data entry points.

### 2.2 `POST /api/media/ingest`

**Authz:** Bearer / `X-Worker-Token` **only if** `SCRAPLING_WORKER_TOKEN` set; otherwise open.  
**Input:** JSON `{ documents: [...] }` — urls/titles/bodies upserted to `MediaDocument`.  
**Validation:** Requires array; skips docs without `url`; little schema hardening (large bodies, arbitrary fields into `$set`).  

**Finding — Confirmed vulnerability (when token unset)**  
**Severity →** High  
**Evidence →** `app/api/media/ingest/route.ts` lines: auth block skipped if `!expected`.  
**Risk →** Unauthenticated corpus poison / DoS via large payloads.  
**Affected location →** Media ingest API.  
**Why it matters →** Feeds forecast features.  
**Recommended fix →** Fail closed; body size limits; field allowlist.

### 2.3 `POST /api/insider/ingest`

**Authz:** Same conditional token pattern as media ingest.  
**Input:** `{ filings: [...] }` with ticker/date normalization.  
**Finding — Confirmed vulnerability (when token unset)** — same pattern as media (`app/api/insider/ingest/route.ts`).

### 2.4 `GET|POST|PUT /api/inngest`

**Authz:** Inngest `serve()`; signing via `INNGEST_SIGNING_KEY` when set.  
**Functions registered:** signup email, weekly news, inactive users, forecast post-close, weekly strategy test, insider scans; day-trader loops **only if** `tradingUiEnabled`; stock alerts if `alertsEnabled`.  

**Finding — Potential risk requiring verification**  
**Severity →** Medium without signing in prod  
**Evidence →** `lib/inngest/client.ts` optional signingKey; `app/api/inngest/route.ts`.  
**Risk →** Unauthorized job trigger.  
**Recommended fix →** Mandatory signing in production.

---

## 3. Server actions (`'use server'`) — authz matrix

| Module / export | Session / ownership check | Notes |
|-----------------|---------------------------|--------|
| **auth.actions** sign-up/in/out/reset | Public by design | Generic error strings |
| **profile.actions** update/changePassword | Via Better Auth headers/session | Input allowlists for profile enums |
| **watchlist.actions** * | `requireUserId` | Scoped queries |
| **alert.actions** * | `requireUserId` + validation | Delete by `_id` + `userId` |
| **trading.actions** list/edit/reject/approve/settings/kill/alpaca | `requireUser` + proposal `userId` | Live gates in risk/alpaca |
| **forecast** `runWatchlistForecastsAction`, `runStrategyTestAction`, `trainFromLastEvalAction` | Session required | No admin role |
| **forecast** `getActiveModelVersionAction`, `getLatestForecastsAction`, `resolveDueForecastsAction`, `getForecastLabDataAction` | **None** | Shared data read/mutate |
| **daytrader** `refreshAnalysisAction` | Session | OK |
| **daytrader** `runMarketReview`, `ingestMediaForSymbol`, `buildAndStorePricing`, `analyzeSymbolForUser` | **None** | Also used by Inngest |
| **daytrader** `getBotDashboardData(userId)` | **Trusts argument** | IDOR risk |
| **finnhub** `searchStocks` (with query) | Session | Empty query uses static list |
| **finnhub** `getQuote`, `getNews`, `getCompanyProfile`, `getWatchlistData`, `getLiveQuotes` | **None** at action layer (`/api/quotes` adds session for live quotes path) | Quota abuse |
| **adanos** `getStockSentimentInsights` | **None** | Burns `ADANOS_API_KEY` if set |

**Finding — Confirmed vulnerability**  
**Severity →** High  
**Evidence →** Exports listed above without `getSession`/`requireUserId` in `'use server'` modules.  
**Risk →** Anonymous invoke via Next server-action protocol.  
**Affected location →** `lib/actions/forecast.actions.ts`, `daytrader.actions.ts`, `finnhub.actions.ts`, `adanos.actions.ts`.  
**Why it matters →** Cost, integrity, IDOR.  
**Recommended fix →** Session gates or move job helpers out of `'use server'` (see `user.actions.ts` pattern).

**Finding — Confirmed vulnerability (IDOR)**  
**Severity →** High  
**Evidence →** `getBotDashboardData(userId)` returns settings including webhook fields.  
**Risk →** Cross-user confidentiality break.  
**Affected location →** `lib/actions/daytrader.actions.ts`.  
**Recommended fix →** Bind to session user only.

**Finding — Missing control (RBAC)**  
**Severity →** Medium–High  
**Evidence →** Any authenticated user may `trainFromLastEvalAction` / promote global weights.  
**Risk →** Model integrity / compute abuse.  
**Recommended fix →** Admin role or disable train in multi-tenant prod.

---

## 4. Middleware surface

- Matcher protects non-API app routes with **cookie presence** only.  
- Excludes: `api`, `_next/static`, `_next/image`, favicon, auth pages, `assets`.  
- Authenticated layouts call `getSession` and redirect if missing (`app/(root)/layout.tsx`).

**Finding — Security weakness**  
**Severity →** Low–Medium  
**Evidence →** `middleware.ts` + cookieCache 5 minutes in `auth.ts`.  
**Risk →** Reliance on layout/action checks; short revoke lag.  
**Recommended fix →** Never add sensitive routes that skip session verification.

---

## 5. User inputs

| Input | Path | Validation observed |
|-------|------|---------------------|
| Email/password | Auth actions / Better Auth | Min password length 8 server; complexity mostly client |
| Profile fields | `updateProfile` | Length/country/enum checks |
| Watchlist symbol/company | watchlist actions | Uppercase/trim; limited sanitization |
| Alert symbol/price/condition | alert actions | Regex + enums + finite price |
| Quote symbols | `/api/quotes` | Regex + cap |
| Forecast symbols | forecast actions | Uppercase; slice caps (e.g. 20) |
| Strategy test opts | `runStrategyTestAction` | Numeric opts; expensive |
| Trade proposal edits | trading actions | Numeric fields; ownership check |
| Trading settings patch | `Object.assign` | Partial bounds on numeric schema; **no webhook URL allowlist** |
| Reset token / new password | auth actions | Better Auth |
| Ingest documents/filings | ingest APIs | Loose |
| Worker fetch URLs | Scrapling `/fetch` | Allowlist when configured |
| OpenInsider HTML parse body | `/openinsider/parse` | Token-gated when set; large HTML |

**Finding — Security weakness**  
**Severity →** Medium  
**Evidence →** Discord webhook assigned without scheme/host allowlist.  
**Risk →** Server-side POST to arbitrary URL on notify.  
**Affected location →** `updateTradingSettingsAction`, `lib/alerts/notify.ts`.  
**Recommended fix →** Strict webhook URL allowlist.

---

## 6. File uploads

**No user file-upload API** found in app routes (no multipart handlers).  
CLI/scripts write local workbooks (`scripts/export-forecast-workbook.ts`) — operator workstation only, not a web upload surface.

**Finding — Recommendation:** Keep uploads out of web app; if added later, virus-scan + type/size limits + authz.

---

## 7. Database

| Item | Detail |
|------|--------|
| Engine | MongoDB 7 (compose) / Atlas URI supported |
| ODM | Mongoose models under `database/models/` |
| Auth collections | Better Auth `user`, sessions, accounts |
| App collections | Watchlist, Alert, MediaDocument, InsiderFiling, FeatureSnapshot, PriceForecast, ModelWeights, EvalRun, FactorAttribution, TradeProposal, OrderAudit, TradingSettings, AnalysisReport, PricingSnapshot, MarketReview |
| Access control | Application-level `userId` filters (no MongoRBAC in app) |
| Network | Compose publishes `27017` with default `root`/`example` |

**Finding — Security weakness**  
**Severity →** Critical if bound to untrusted network  
**Evidence →** `docker-compose.yml` ports + passwords.  
**Risk →** Full data breach.  
**Recommended fix →** Internal-only Mongo; strong creds; TLS for Atlas.

---

## 8. Storage / filesystem

- Mongo volume `mongo-data`.  
- Worker mounts `sources.yaml` read-only.  
- Next `public/` static assets.  
- No object-storage integration found.

---

## 9. Webhooks & outbound notifications

| Channel | Trigger | Secret |
|---------|---------|--------|
| Nodemailer email | Signup/jobs, password reset, proposal alerts | `NODEMAILER_*` |
| Telegram Bot API | Proposal notify | `TELEGRAM_BOT_TOKEN` + chat id |
| Discord incoming webhook | Proposal notify | Env or per-user URL |
| Inngest cloud → `/api/inngest` | Schedules/events | Signing key |
| Worker → Next ingest | After scrape | Shared worker token |

Inbound Discord/Telegram **command bots** not implemented (outbound only).

---

## 10. Third-party / egress

| Vendor | Used for | Credential |
|--------|----------|------------|
| Finnhub | Quotes, search, news, candles | Finnhub keys |
| Alpaca | Bars, account, orders | Alpaca keys |
| Yahoo chart API | Daily bar fallback | None (public) |
| Gemini / MiniMax / Siray | LLM explain/clamp / emails | AI keys |
| Tavily / Brave / SerpAPI | News/social discovery | Search keys |
| Scrapling / httpx | HTML fetch | Worker token |
| OpenInsider.com | Form 4 HTML | None (scrape) |
| Adanos | Optional sentiment | `ADANOS_API_KEY` |
| ConvertKit | Optional marketing scripts | `KIT_*` |
| TradingView embed | Client widget | Script URL + JSON config via `innerHTML` |
| Vercel Analytics | Product analytics | Platform |

**Finding — Potential risk requiring verification**  
**Severity →** Low–Medium  
**Evidence →** `hooks/useTradingViewWidget.tsx` sets `script.innerHTML = serializedConfig` from app-built config (not raw user HTML).  
**Risk →** XSS if config ever includes unsanitized user content.  
**Recommended fix →** Keep config server-controlled; CSP.

---

## 11. Admin

**No dedicated admin UI or role model** found. Elevated power = possession of env secrets + any registered user for global Lab train.

**Finding — Missing control**  
**Severity →** Medium  
**Recommended fix →** Explicit admin role for train/promote and ingest token rotation ops.

---

## 12. Network / deploy

| Surface | Detail |
|---------|--------|
| `web:3000` | Published |
| `mongodb:27017` | Published to host |
| `scrapling-worker:8091` | Published; listens `0.0.0.0` |
| `vercel.json` | Region `bom1` only; no security headers |
| Dockerfile (web) | `npm install` + build + `npm start`; no non-root user specified |
| Worker Dockerfile | `python:3.12-slim`, uvicorn `0.0.0.0` |

**Finding — Security weakness**  
**Severity →** High (compose defaults on shared host)  
**Evidence →** Published DB/worker ports; default Mongo password; empty worker token default.  
**Risk →** Lateral movement from LAN/internet.  
**Recommended fix →** Compose profiles for prod without host binds; reverse proxy TLS; non-root containers.

---

## 13. Scrapling worker endpoints

| Path | Auth when token set | Purpose |
|------|---------------------|---------|
| `GET /health` | No | Liveness; reveals `token_required` |
| `GET /sources` | Yes | Allowlist/RSS config |
| `POST /fetch` | Yes | Fetch URLs → media |
| `POST /ingest` | Yes | Discover metadata → fetch bodies |
| `POST /rss` | Yes | Crawl configured RSS |
| `POST /openinsider/scan` | Yes | Form 4 scrape + persist |
| `POST /openinsider/parse` | Yes | Parse provided HTML |

If token unset: mutation endpoints open (dev convenience).

**Finding — Confirmed vulnerability (token unset)** — see threat-model T1.

**Finding — Potential risk requiring verification (SSRF)**  
**Severity →** Medium  
**Evidence →** URL fetch with redirect follow; empty allowlist allows all hosts.  
**Risk →** Internal SSRF from worker.  
**Recommended fix →** Enforce allowlist + private-IP deny.

---

## 14. Dependencies

| Stack | Manager |
|-------|---------|
| Next 15.5.7, React 19, better-auth, mongoose, inngest, nodemailer, … | npm (`package-lock.json`) |
| FastAPI/uvicorn/httpx/scrapling/pyyaml (worker) | `services/scrapling-worker/requirements.txt` |

**Finding — Missing control**  
**Severity →** Medium  
**Evidence →** No Dependabot/Snyk config in `.github/` (only `FUNDING.yml`). Build ignores ESLint/TS errors.  
**Risk →** Known CVEs linger.  
**Recommended fix →** `npm audit`/OSV in CI; pin and patch; fail on high CVEs.

---

## 15. Other reachable surfaces

- **Server actions CSRF:** Next.js server actions use framework POST + origin checks (version-dependent). No custom CSRF tokens observed.  
  **Label:** Potential risk requiring verification — confirm Next 15.5 defaults remain enabled in deploy.  
- **Password reset:** Email link flow; HTML escaped.  
- **Social OAuth:** Enabled only when client id env set; account linking disabled.  
- **CLI scripts:** `scripts/*` with Mongo/Kit — local operator surface if env loaded.  
- **Forecast Lab / trading code paths** remain in bundle even when UI redirected — actions still callable.

---

## 16. Surface priority for hardening

1. Fail-closed worker + ingest token; unpublish Mongo/worker ports.  
2. Close unauthenticated `'use server'` job/read helpers; fix `getBotDashboardData` IDOR.  
3. Server-only Finnhub keys; rate limits on auth and expensive actions.  
4. Webhook URL allowlist; RBAC for train/promote.  
5. Security headers + dependency CI + non-root images.
