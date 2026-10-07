# Threat model — Auto Day Trader / OpenStock

**Scope:** `nitishberi/OpenStock` `main` at merge of PR #6 (OpenInsider Form 4 + prediction stack).  
**Method:** Code review of architecture, auth, API routes, server actions, Scrapling worker, Docker/compose, Inngest, third-party integrations. No live exploitation. No secret values recorded.

---

## 1. System summary

| Piece | Role |
|-------|------|
| Next.js 15 app (`web`) | Marketing site, Better Auth, authenticated forecasts/Lab, optional trading bot UI |
| MongoDB | Users/sessions (Better Auth), watchlists, media, insider filings, forecasts, trading docs |
| Scrapling worker (FastAPI) | Allowlisted HTML fetch; OpenInsider Form 4 scrape; optional POST back to Next ingest |
| Inngest | Cron/jobs: forecast resolve, strategy test, insider scan; day-trader loop only if trading UI on |
| Third parties | Finnhub, Gemini (and optional MiniMax/Siray), Tavily/Brave/SerpAPI, Alpaca, Nodemailer, Telegram, Discord, optional Adanos/ConvertKit, Yahoo chart fallback |

Product default: **prediction-first** (`TRADING_UI_ENABLED=false`). Trading Approve/Alpaca code remains callable as server actions when keys/env allow.

---

## 2. Assets

| Asset | Sensitivity | Notes |
|-------|-------------|--------|
| User accounts (email, password hash, profile) | High | Better Auth + MongoDB `user` / session collections |
| Session cookies | High | Cookie cache up to 5 minutes after revoke |
| Watchlists, alerts | Medium | Per-user |
| Trade proposals, order audit, trading settings | High | Includes optional Discord webhook / Telegram chat IDs |
| Alpaca API credentials | Critical | Can place paper/live orders |
| Finnhub / Gemini / Tavily / other API keys | High | Quota abuse + data cost; Finnhub also via `NEXT_PUBLIC_*` |
| `BETTER_AUTH_SECRET`, OAuth client secrets | Critical | Session forgery / account takeover |
| `SCRAPLING_WORKER_TOKEN` | High | Gates worker + ingest when set |
| `NODEMAILER_*`, Telegram/Discord secrets | High | Spoofed notifications / inbox spam |
| Forecast models, eval runs, media/insider corpus | Medium | Integrity of research product; shared across users |
| MongoDB data volume | Critical | Full store if DB reachable |

---

## 3. Trust boundaries

```
[Browser / untrusted client]
        |  HTTPS (assumed at deploy)
        v
[Next.js edge middleware]  -- cookie presence only; matcher excludes /api/*
        |
        +--> public marketing + auth pages
        +--> authenticated RSC layouts (getSession)
        +--> server actions ('use server')  -- must enforce auth themselves
        +--> /api/auth/*  (Better Auth)
        +--> /api/quotes  (session required)
        +--> /api/media/ingest , /api/insider/ingest  (worker token IF set)
        +--> /api/inngest  (Inngest signing when configured)
        |
        +--> MongoDB
        +--> Finnhub / Gemini / Tavily / Alpaca / email / Telegram / Discord
        |
[Scrapling worker :8091]  <-- token IF set; published port in compose
        |  allowlist fetch to internet
        +--> optional WEB_*_INGEST_URL back to Next
        +--> optional direct Mongo write
```

**Boundary notes (verified):**
- Middleware does **not** protect `/api/*` (explicit matcher exclusion).
- Ingest auth is conditional: if `SCRAPLING_WORKER_TOKEN` is unset/empty, Next ingest and worker mutation endpoints accept unauthenticated calls (by design for local/dev).
- Compose binds MongoDB `27017` and worker `8091` to the host with default `root` / `example`.

---

## 4. Actors

| Actor | Intent |
|-------|--------|
| Anonymous internet user | Probe public pages, auth, open APIs, worker, Mongo if exposed |
| Registered user | Use forecasts/Lab; if trading UI/env enabled, approve trades |
| Malicious registered user | Abuse shared API quota, poison shared forecast/media data, IDOR, webhook SSRF-style misuse |
| Compromised/insider deployer | Read env, DB, trading keys |
| Scrapling worker (semi-trusted) | Should only push media/insider; token-shared with Next |
| Inngest cloud | Invokes registered functions if signing validates |
| Third-party APIs | Supply market/AI/news data; compromise is supply-chain |

---

## 5. Entry points

| Entry | Authn (as implemented) |
|-------|-------------------------|
| Marketing `/`, `/about`, `/help`, `/terms`, `/api-docs`, `/sponsor` | Public |
| `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password` | Public |
| `/api/auth/[...all]` | Better Auth handlers |
| Authenticated app routes (`/dashboard`, `/forecasts`, `/watchlist`, …) | Middleware cookie presence + layout `getSession` |
| Server actions under `lib/actions/*.ts` | Per-function (mixed; see attack-surface) |
| `GET /api/quotes` | Session required |
| `POST /api/media/ingest`, `POST /api/insider/ingest` | Token **only if** env set |
| `GET/POST/PUT /api/inngest` | Inngest serve + optional `INNGEST_SIGNING_KEY` |
| Scrapling `/health` | Public |
| Scrapling `/fetch`, `/ingest`, `/rss`, `/openinsider/*`, `/sources` | Token **only if** env set |
| Docker-published Mongo / worker ports | Network exposure |

---

## 6. Existing mitigations (confirmed in code)

- Better Auth with Mongo adapter; `requireUserId` / session checks on watchlist, alerts, trading mutate paths, several forecast actions.
- Account linking **disabled** with explicit comment about email-pre-registration takeover risk when verification is off.
- Password reset HTML escapes user-controlled name/URL fragments (`escapeHtml`).
- Quotes API: session + symbol allowlist regex + max 25 symbols.
- Alert create: symbol/condition/price validation; delete scoped by `userId`.
- Trading: proposals scoped by `userId`; live blocked unless `ALPACA_ALLOW_LIVE=true`; paper forced when live not allowed; kill switch; daily proposal caps; live confirm phrase gate; orders only via Approve path (not cron auto-submit).
- Trading UI hidden by default (`TRADING_UI_ENABLED`).
- Scrapling domain allowlist in `sources.yaml` (when non-empty); polite rate limit; OpenInsider list cache.
- `user.actions.ts` deliberately **not** `'use server'` (bulk email enumeration helpers kept server-only).
- Mongo URI redacted in connect log (`//***@`).
- `.gitignore` ignores `.env*` except `.env.example`.
- No hardcoded live API key material found in application source (placeholders only in `.env.example`).

---

## 7. Threats, scenarios, risk

Severity scale: **Critical / High / Medium / Low**. Likelihood assumes a typical internet-facing or LAN-exposed compose deploy unless noted.

---

### T1 — Unauthenticated ingest / worker when token unset

**Label:** Confirmed vulnerability (when `SCRAPLING_WORKER_TOKEN` empty in a reachable deploy)  
**Severity:** High  
**Evidence:** `app/api/media/ingest/route.ts` and `app/api/insider/ingest/route.ts` skip auth if `expected` is falsy; worker `require_token` returns early if `APP_TOKEN` empty (`services/scrapling-worker/main.py`). Compose default `${SCRAPLING_WORKER_TOKEN:-}` can be empty; ports `8091` published.  
**Risk:** Anyone who can reach the host can upsert media/insider documents (poison features/forecasts) or drive SSRF-like fetches via worker `/fetch` against allowlisted (or all, if allowlist empty) URLs.  
**Affected location:** Next ingest routes; Scrapling FastAPI app; `docker-compose.yml` ports.  
**Why it matters:** Shared Mongo research corpus integrity; abuse of egress; insider feature manipulation.  
**Recommended fix:** Fail closed—require non-empty token in production; do not publish worker port; network-isolate worker↔web.  
**Likelihood:** High on default compose to a non-localhost network; Low on locked-down prod with token set and no public worker.

---

### T2 — Compose Mongo with weak defaults and host bind

**Label:** Security weakness  
**Severity:** Critical (if host reachable); Medium (localhost-only lab)  
**Evidence:** `docker-compose.yml` sets `MONGO_INITDB_ROOT_PASSWORD: example`, URI `mongodb://root:example@...`, `ports: "27017:27017"`.  
**Risk:** Full database compromise (users, sessions, trading settings/webhooks, forecasts).  
**Affected location:** `docker-compose.yml`, `.env.example` sample URI.  
**Why it matters:** Single credential + published port is a classic footgun.  
**Recommended fix:** Strong unique password; bind Mongo to internal network only (no host publish) in any shared environment.

---

### T3 — Unauthenticated / under-authorized server actions (shared data & jobs)

**Label:** Confirmed vulnerability (callable without session)  
**Severity:** High (abuse/cost/integrity); Medium for read-only forecast dumps  
**Evidence:** `'use server'` module `lib/actions/forecast.actions.ts` exports without session checks: `getActiveModelVersionAction`, `getLatestForecastsAction`, `resolveDueForecastsAction`, `getForecastLabDataAction`. `lib/actions/daytrader.actions.ts` exports `runMarketReview`, `ingestMediaForSymbol`, `buildAndStorePricing`, `analyzeSymbolForUser` without session (intended for Inngest but still server-action exports). `getStockSentimentInsights` in `adanos.actions.ts` has no session check. Several Finnhub helpers (`getQuote`, `getNews`, `getCompanyProfile`, …) lack session gates (search with query does check).  
**Risk:** Anonymous callers burn Finnhub/Tavily/Gemini/Scrapling quota; mutate shared `PriceForecast` / media / eval-adjacent state; trigger expensive strategy-adjacent work via daytrader helpers.  
**Affected location:** `lib/actions/forecast.actions.ts`, `daytrader.actions.ts`, `finnhub.actions.ts`, `adanos.actions.ts`.  
**Why it matters:** Server actions are public HTTP endpoints in Next.js.  
**Recommended fix:** Require session (or move job-only helpers out of `'use server'` modules, matching `user.actions.ts` pattern); rate-limit.

---

### T4 — IDOR pattern on `getBotDashboardData(userId)`

**Label:** Confirmed vulnerability (if invoked with attacker-chosen id)  
**Severity:** High  
**Evidence:** `getBotDashboardData(userId)` in `daytrader.actions.ts` trusts the `userId` argument and returns reports, proposals, settings (including notify webhook fields). Page currently passes `session.user.id`, but the export is a server action that does not re-bind to session.  
**Risk:** Cross-user read of trading proposals/settings/webhooks.  
**Affected location:** `lib/actions/daytrader.actions.ts`, `/bot` page.  
**Why it matters:** Classic confused-deputy / IDOR on server actions.  
**Recommended fix:** Ignore client `userId`; always use `requireUserId()` / session.

---

### T5 — No RBAC; any user can train/promote models and burn Lab compute

**Label:** Missing control  
**Severity:** Medium–High  
**Evidence:** No admin/role checks in codebase; `runStrategyTestAction` / `trainFromLastEvalAction` only require any signed-in session. Model weights are global (`ModelWeights.active`).  
**Risk:** Shared-model sabotage; expensive Gemini/media runs; eval spam.  
**Affected location:** `lib/actions/forecast.actions.ts`, Forecast Lab UI.  
**Why it matters:** Multi-tenant app with single global model store.  
**Recommended fix:** Admin-only promote/train; per-tenant models or read-only Lab for normal users; rate limits.

---

### T6 — Email verification disabled + UI password rules not enforced server-side

**Label:** Security weakness  
**Severity:** Medium  
**Evidence:** `requireEmailVerification: false` in `lib/better-auth/auth.ts`. Client `PASSWORD_VALIDATION` / `PASSWORD_RULES` require upper/lower/digit; Better Auth config only `minPasswordLength: 8`.  
**Risk:** Disposable/fake accounts; weaker passwords accepted if client bypassed; account-linking risk already mitigated by disabling linking.  
**Affected location:** Auth config + sign-up forms.  
**Why it matters:** Enables signup spam and weaker credentials against password-reset/email channels.  
**Recommended fix:** Enforce complexity server-side; enable verification before sensitive features.

---

### T7 — Finnhub key in `NEXT_PUBLIC_*`

**Label:** Security weakness (design exposure)  
**Severity:** Medium  
**Evidence:** `.env.example` and code prefer `NEXT_PUBLIC_FINNHUB_API_KEY`; bundled to client by Next convention. Server also accepts `FINNHUB_API_KEYS`.  
**Risk:** Key extraction from browser → quota theft.  
**Affected location:** Env naming; `lib/actions/finnhub.actions.ts`, `lib/forecast/bars.ts`.  
**Why it matters:** Market-data costs and DoS against free tier.  
**Recommended fix:** Server-only keys; all quotes via authenticated `/api/quotes` (already partially this pattern).

---

### T8 — Middleware session cookie presence-only

**Label:** Security weakness (partial control)  
**Severity:** Low–Medium  
**Evidence:** `middleware.ts` uses `getSessionCookie` presence; comments note it “prevents obviously unauthorized users.” Real session validation in layouts/actions via `getSession`. Cookie cache: revoked session valid up to 5 minutes (`auth.ts`).  
**Risk:** Stale cookie may pass middleware briefly; forged cookie name alone does not grant data if layout/actions verify—but any route relying only on middleware would be unsafe.  
**Affected location:** `middleware.ts`, `lib/better-auth/auth.ts`.  
**Why it matters:** Defense-in-depth gaps if new routes skip `getSession`.  
**Recommended fix:** Keep requiring `getSession`/`requireUserId` on every sensitive path; consider shorter cache for high-risk ops.

---

### T9 — Live trading confirm phrase default `LIVE`

**Label:** Security weakness  
**Severity:** Medium (when live enabled)  
**Evidence:** `ALPACA_LIVE_CONFIRM_PHRASE || 'LIVE'` in `lib/trading/risk.ts`. Live still needs `ALPACA_ALLOW_LIVE=true` + Approve.  
**Risk:** Guessable second factor for live approve if UI exposed.  
**Affected location:** Risk guards + env.  
**Why it matters:** Accidental/coerced live orders.  
**Recommended fix:** Require strong unique phrase; never default in production.

---

### T10 — Discord/Telegram settings stored without URL/chat validation

**Label:** Potential risk requiring verification  
**Severity:** Medium  
**Evidence:** `updateTradingSettingsAction` `Object.assign`s `discordWebhookUrl` / `telegramChatId` without allowlisting scheme/host (`lib/actions/trading.actions.ts`). `notify.ts` POSTs to supplied Discord URL.  
**Risk:** User-stored webhook used as SSRF/exfil channel when notifications fire (user-targeted, but can hit internal URLs if outbound network is open).  
**Affected location:** Trading settings + `lib/alerts/notify.ts`.  
**Why it matters:** Notification path performs server-side HTTP POST to attacker-controlled URL.  
**Recommended fix:** Allowlist `https://discord.com/api/webhooks/` (and Telegram chat id format); block private IP ranges.

---

### T11 — Missing security headers / CORS hardening / rate limits

**Label:** Missing control  
**Severity:** Medium  
**Evidence:** `next.config.ts` has no CSP/HSTS/frame guards; no app-level rate limiting found; CORS helpers absent (Next defaults). Inngest/auth rely on framework defaults.  
**Risk:** Clickjacking, XSS impact amplification, credential stuffing, action spam.  
**Affected location:** Deploy/`next.config.ts`/edge.  
**Why it matters:** Standard web hardening absent.  
**Recommended fix:** Security headers at CDN/Vercel; auth + action rate limits; WAF as appropriate.

---

### T12 — Inngest endpoint without signing key in local/dev

**Label:** Potential risk requiring verification  
**Severity:** Medium (misconfigured prod); Low (local CLI)  
**Evidence:** `signingKey: process.env.INNGEST_SIGNING_KEY` optional; docs say local CLI works without.  
**Risk:** If production `/api/inngest` is reachable without signing, attackers may trigger jobs (forecast resolve, insider scan, email functions).  
**Affected location:** `app/api/inngest/route.ts`, `lib/inngest/client.ts`.  
**Why it matters:** Privileged batch operations.  
**Recommended fix:** Require signing keys in production; monitor unauthorized invokes.

---

### T13 — SSRF via Scrapling fetch (bounded)

**Label:** Potential risk requiring verification  
**Severity:** Medium if token stolen or unset; Low if token + allowlist enforced  
**Evidence:** Worker fetches caller-supplied URLs after allowlist check; empty allowlist allows all (`domain_allowed`). Stealth/httpx follow redirects.  
**Risk:** Internal network scan / metadata service access from worker container.  
**Affected location:** `services/scrapling-worker/main.py`.  
**Why it matters:** Worker has egress and optional Mongo credentials.  
**Recommended fix:** Always non-empty allowlist; block RFC1918/link-local; require token; no host port publish.

---

### T14 — Build ignores ESLint/TypeScript errors

**Label:** Recommendation / process weakness  
**Severity:** Low–Medium  
**Evidence:** `next.config.ts` `eslint.ignoreDuringBuilds` and `typescript.ignoreBuildErrors` true.  
**Risk:** Auth regressions ship unnoticed.  
**Recommended fix:** Fail builds on type/lint errors in CI.

---

## 8. Attack scenarios (condensed)

1. **Poison forecasts:** Open ingest (no token) → upsert fake media/insider → features tilt → Lab/train polluted.  
2. **Quota theft:** Call unauthenticated Finnhub/daytrader/forecast actions → exhaust keys.  
3. **IDOR dashboard:** Invoke `getBotDashboardData` with victim user id → read proposals/webhooks.  
4. **Compose wipeout:** Connect to published Mongo `root/example` → dump/drop.  
5. **Live trade:** Enable live flags + guess `LIVE` phrase + Approve → real Alpaca order (multi-control bypass needed).  
6. **Webhook SSRF:** Set Discord URL to internal endpoint → trigger proposal notify.

---

## 9. Impact summary

| Impact area | Worst case |
|-------------|------------|
| Confidentiality | User PII, session, trading settings, API keys via DB/env |
| Integrity | Shared forecasts/media/insider/model weights |
| Availability | API quota exhaustion; Mongo/worker DoS |
| Financial | Alpaca live orders; third-party bill shock |

---

## 10. Residual risk statement

Existing auth and trading guards are real and meaningful for signed-in, proposal-scoped flows. The largest residual risks for a default or semi-exposed deploy are **conditional worker/ingest auth**, **published weak Mongo**, and **`'use server'` job helpers without session checks**. This document does not claim production deploy configuration beyond what is in-repo.
