# Secrets inventory & handling — Auto Day Trader / OpenStock

**Rule for this document:** env var **names** and file **names** only. No secret values. Project store secrets under `/cursor/stores/bc-01a105ad-9570-7e37-ab99-7b946307cee4/secrets/` were inspected for **filenames and key names only** (parsed with `cut -d= -f1`); contents were never printed into docs or logs.

---

## 1. Where secrets are expected

### 1.1 Repository (application)

| Source | Purpose |
|--------|---------|
| `.env` (gitignored) | Local/runtime config; compose `env_file: .env` for `web` |
| `.env.example` | Documented placeholders only (safe to commit) |
| Process environment / host secrets | Vercel, Docker, CI |
| `scripts/check-env.mjs` | Lists required/optional env **names** for operators |

### 1.2 Project Agent Store (Context) — filenames only

Path: `/cursor/stores/bc-01a105ad-9570-7e37-ab99-7b946307cee4/secrets/`

| Filename | Env var names present (names only) |
|----------|-------------------------------------|
| `alpaca.env` | `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, `ALPACA_MODE`, `ALPACA_BASE_URL`, `ALPACA_ALLOW_LIVE` |
| `finnhub.env` | `NEXT_PUBLIC_FINNHUB_API_KEY`, `FINNHUB_API_KEY`, `FINNHUB_API_KEYS`, `FINNHUB_BASE_URL` |
| `gemini.env` | `GEMINI_API_KEY`, `AI_PROVIDER`, `GEMINI_MODEL` |
| `tavily.env` | `TAVILY_API_KEY` |
| `project.env` | Union of above Finnhub + Gemini + Tavily + Alpaca names |

These store files are **not** part of the GitHub repo; treat them as operator secret material for the Project.

---

## 2. Complete env name catalog (from `.env.example` + code references)

### Auth / app

| Name | Client-visible? | Notes |
|------|-----------------|--------|
| `BETTER_AUTH_SECRET` | No | Required for session integrity |
| `BETTER_AUTH_URL` | No | Base URL for auth/reset links |
| `NEXT_PUBLIC_APP_URL` | Yes | Public app URL |
| `NODE_ENV` | No | Runtime mode |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ID may appear in client OAuth flow | Social optional |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | ID may appear in client OAuth flow | Social optional |

### Database

| Name | Client-visible? | Notes |
|------|-----------------|--------|
| `MONGODB_URI` | No | Includes credentials in URI form |
| `MONGODB_DB` | No | Worker DB name (default `openstock`) |
| `MONGODB_GOOGLE_DNS` | No | DNS tweak flag |

### Market data / AI / news

| Name | Client-visible? | Notes |
|------|-----------------|--------|
| `NEXT_PUBLIC_FINNHUB_API_KEY` | **Yes** | Embedded in client bundle if set |
| `FINNHUB_API_KEY` | No | Legacy alias |
| `FINNHUB_API_KEYS` | No | Preferred server rotation list |
| `FINNHUB_BASE_URL` | No | |
| `NEXT_PUBLIC_OPENSTOCK_DATA_MODE` | Yes | `cached` / `realtime` |
| `GEMINI_API_KEY` | No | |
| `GEMINI_MODEL` | No | |
| `AI_PROVIDER` | No | |
| `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` / `MINIMAX_MODEL` | No | Optional |
| `SIRAY_API_KEY` | No | Optional |
| `TAVILY_API_KEY` / `TAVILY_API_KEYS` | No | |
| `BRAVE_API_KEY` / `BRAVE_API_KEYS` | No | |
| `SERPAPI_API_KEY` / `SERPAPI_API_KEYS` | No | |
| `ADANOS_API_KEY` / `ADANOS_API_BASE_URL` | No | Legacy sentiment card |

### Trading / alerts

| Name | Client-visible? | Notes |
|------|-----------------|--------|
| `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` | No | Critical |
| `ALPACA_MODE` | No | `paper` / `live` |
| `ALPACA_ALLOW_LIVE` | No | Must be `true` for live |
| `ALPACA_LIVE_CONFIRM_PHRASE` | No | Defaults to weak `LIVE` if unset |
| `ALPACA_PAPER_BASE_URL` / `ALPACA_LIVE_BASE_URL` / `ALPACA_DATA_BASE_URL` / `ALPACA_DATA_FEED` | No | |
| `ALPACA_BASE_URL` | No | Seen in Project store file; code primarily uses paper/live/data URL vars |
| `TRADING_UI_ENABLED` / `NEXT_PUBLIC_TRADING_UI_ENABLED` | Public flag if `NEXT_PUBLIC_*` | Feature gate |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | No | |
| `DISCORD_WEBHOOK_URL` | No | Also per-user DB field |

### Email / jobs / worker

| Name | Client-visible? | Notes |
|------|-----------------|--------|
| `NODEMAILER_EMAIL` / `NODEMAILER_PASSWORD` | No | SMTP / app password |
| `INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY` | No | |
| `SCRAPLING_WORKER_URL` | No | |
| `SCRAPLING_WORKER_TOKEN` | No | Shared with worker + ingest |
| `WEB_INGEST_URL` / `WEB_INSIDER_INGEST_URL` | No | Worker → Next |
| `SOURCES_CONFIG` / `SCRAPE_RATE_LIMIT_SECONDS` / `SCRAPLING_STEALTH` / `OPENINSIDER_LIST_CACHE_SECONDS` / `LOG_LEVEL` | No | Worker ops |

### Marketing / misc (optional)

| Name | Notes |
|------|--------|
| `KIT_API_KEY` / `KIT_API_SECRET` / `KIT_WELCOME_FORM_ID` | ConvertKit scripts/`lib/kit.ts` |

### Compose-baked non-secret defaults (still credentials)

| Name / value pattern | Risk |
|----------------------|------|
| Mongo init user `root` / password `example` in compose | Well-known sample credential in repo |

---

## 3. Env / config handling (as implemented)

- Runtime reads via `process.env.*` across `lib/`, API routes, worker Python `os.getenv`.
- Docker Compose injects Mongo URI and Scrapling URL; worker token from host env with empty default.
- Better Auth secret/baseURL from env at auth factory creation.
- Alpaca headers built server-side only (`APCA-API-KEY-ID` / `APCA-API-SECRET-KEY`).
- Scrapling client sends `X-Worker-Token` + `Authorization: Bearer` when token present (`lib/news/scrapling-client.ts`).
- Mongo connect logs redact credentials in URI (`database/mongoose.ts`).

---

## 4. Findings

### S1 — `NEXT_PUBLIC_FINNHUB_API_KEY` client exposure

**Label:** Security weakness  
**Severity →** Medium  
**Evidence →** Named in `.env.example`; used as fallback in `lib/actions/finnhub.actions.ts`, `lib/forecast/bars.ts`, `daytrader.actions.ts`. Next.js inlines `NEXT_PUBLIC_*` into client JS.  
**Risk →** Key harvest from browser → Finnhub quota theft.  
**Affected location →** Env naming + Finnhub call sites.  
**Why it matters →** Shared org key often powers all users.  
**Recommended fix →** Use only `FINNHUB_API_KEYS` (server); remove public key from production.

---

### S2 — Ingest/worker shared secret optional

**Label:** Confirmed vulnerability (misconfig)  
**Severity →** High when reachable without token  
**Evidence →** Auth skipped when `SCRAPLING_WORKER_TOKEN` unset (Next ingest routes + worker `require_token`). `.env.example` placeholder `change-me-in-production`.  
**Risk →** Unauthenticated write to media/insider; unauthenticated scrape driving.  
**Affected location →** `app/api/media/ingest`, `app/api/insider/ingest`, `services/scrapling-worker/main.py`.  
**Why it matters →** Token is the only gate for those surfaces.  
**Recommended fix →** Fail closed if unset when `NODE_ENV=production`; rotate regularly; never commit real token.

---

### S3 — Weak default Mongo credentials in compose

**Label:** Security weakness  
**Severity →** Critical if exposed  
**Evidence →** `docker-compose.yml` / `.env.example` use `root` / `example`.  
**Risk →** Trivial DB takeover.  
**Affected location →** Compose + example env.  
**Why it matters →** URI embeds password; port published.  
**Recommended fix →** Unique secrets via env; no host bind for Mongo in shared deploys.

---

### S4 — No hardcoded production API keys in source (positive finding)

**Label:** Recommendation (keep)  
**Severity →** N/A (control present)  
**Evidence →** Repo scan for common key patterns in app sources returned no live key material; placeholders only. `.gitignore` ignores `.env*`.  
**Risk →** Residual: future commits or docs pasting values.  
**Affected location →** Repo hygiene.  
**Why it matters →** Prevents public GitHub leak.  
**Recommended fix →** Keep pre-commit secret scanning; never paste store secret values into PRs/docs.

---

### S5 — Live confirm phrase default

**Label:** Security weakness  
**Severity →** Medium when live trading enabled  
**Evidence →** `process.env.ALPACA_LIVE_CONFIRM_PHRASE || 'LIVE'` in `lib/trading/risk.ts`.  
**Risk →** Guessable confirmation.  
**Affected location →** Trading risk guards.  
**Why it matters →** Second gate for live Approve.  
**Recommended fix →** Require strong phrase; refuse live if unset.

---

### S6 — Secrets in logs / errors

**Label:** Potential risk requiring verification  
**Severity →** Low–Medium  
**Evidence →** Mongo URI redacted on connect (good). Auth failures log generic messages. Some paths `console.error` / `console.log` signup/inngest events with **email** (PII, not API keys). Alpaca/Gemini errors may surface provider message strings to UI (`getAlpacaAccountAction` returns `error: String(e)`).  
**Risk →** PII in logs; accidental token echo if a dependency throws URL-with-key.  
**Affected location →** Auth actions, trading account action, nodemailer.  
**Why it matters →** Log aggregators become secret stores.  
**Recommended fix →** Sanitize errors; never log Authorization headers or full URIs with query `key=` / `token=`.

---

### S7 — Gemini key in query string

**Label:** Security weakness  
**Severity →** Low–Medium  
**Evidence →** `lib/ai-provider.ts` builds Gemini URL with `?key=${config.apiKey}`.  
**Risk →** Key appears in outbound URL (proxy logs, Referer if misused, APM).  
**Affected location →** `lib/ai-provider.ts`.  
**Why it matters →** Query-string secrets are frequently logged.  
**Recommended fix →** Prefer header-based auth if API supports; scrub access logs.

---

### S8 — Per-user Discord webhook / Telegram chat in Mongo

**Label:** Security weakness  
**Severity →** Medium  
**Evidence →** `TradingSettings` schema stores `discordWebhookUrl`, `telegramChatId`; returned via dashboard/settings actions.  
**Risk →** DB leak ⇒ attacker posts as user webhooks / chats.  
**Affected location →** `database/models/trading-settings.model.ts`, trading actions.  
**Why it matters →** Webhooks are bearer URLs.  
**Recommended fix →** Encrypt at rest or store only server-env webhooks; redact in API responses.

---

### S9 — Git / history risk

**Label:** Potential risk requiring verification  
**Severity →** Low (current tree clean of `.env`)  
**Evidence →** Tracked env-related files: `.env.example`, `scripts/check-env.mjs` only. No `.env` in `git ls-files`. Historical accidental commits not exhaustively audited beyond presence of `.env` add commits (none found in quick scan).  
**Risk →** Future force-push / example filled with real keys.  
**Recommended fix →** Secret scanning in CI; rotate if history ever contained values.

---

### S10 — Password / OAuth / Kit secrets

**Label:** Missing control / recommendation  
**Severity →** Medium (ops)  
**Evidence →** Nodemailer uses app password env; Kit scripts require `KIT_*`; OAuth secrets only when social enabled.  
**Risk →** Stale credentials after staff turnover.  
**Recommended fix →** Documented rotation schedule (below).

---

## 5. Client-side exposure risks (summary)

| Item | Exposed? |
|------|----------|
| `NEXT_PUBLIC_*` Finnhub / app URL / trading UI flag | Yes if set |
| Alpaca, Gemini, Tavily, Better Auth secret, Mongo URI, worker token | Should stay server-only (verified not named `NEXT_PUBLIC_` except Finnhub/app/trading flag) |
| Session cookie | Browser HttpOnly session (Better Auth defaults; not re-audited binary) |

---

## 6. Rotation requirements

| Secret | Rotate when | Notes |
|--------|-------------|--------|
| `BETTER_AUTH_SECRET` | Suspected leak; periodic | Invalidates sessions |
| `MONGODB_URI` password | Leak / compose default still in use | Update all services |
| `SCRAPLING_WORKER_TOKEN` | Leak / staff change | Update web + worker together |
| `ALPACA_*` | Leak / trader leave / live incident | Paper vs live separately |
| `FINNHUB_*` / `NEXT_PUBLIC_FINNHUB_*` | Browser exposure or quota abuse | Prefer server-only after rotation |
| `GEMINI_API_KEY` / other AI | Leak / cost spike | |
| `TAVILY_*` / `BRAVE_*` / `SERPAPI_*` | Leak | |
| `NODEMAILER_PASSWORD` | Leak / phishing | App passwords |
| `TELEGRAM_BOT_TOKEN` / `DISCORD_WEBHOOK_URL` | Leak | Regenerate bot/webhook |
| `INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY` | Leak | |
| OAuth client secrets | Leak | |
| `KIT_*` | Leak | |
| Per-user Discord webhooks in DB | User request / breach | |

---

## 7. Operator checklist (names only)

1. Never commit `.env` or Project `secrets/*.env` into git.  
2. Production: non-empty unique `SCRAPLING_WORKER_TOKEN`, `BETTER_AUTH_SECRET`, Mongo password.  
3. Prefer `FINNHUB_API_KEYS` over `NEXT_PUBLIC_FINNHUB_API_KEY`.  
4. Keep `ALPACA_ALLOW_LIVE=false` unless intentionally going live; set a strong `ALPACA_LIVE_CONFIRM_PHRASE`.  
5. Set `INNGEST_SIGNING_KEY` for any internet-facing deploy.  
6. Do not paste secret **values** into issues, PRs, or `brain/` docs.
