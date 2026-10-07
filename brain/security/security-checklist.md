# Security checklist — Auto Day Trader / OpenStock

Project-specific checklist. Status reflects **code/config on `main` as reviewed**, not a future target state.

Legend: **Pass** (control present) · **Partial** · **Fail** · **N/A** · **Verify** (needs deploy-time confirmation)

For important gaps, findings use: **Severity → Evidence → Risk → Affected location → Why it matters → Recommended fix**, plus a label.

---

## 1. Authentication

| Check | Status |
|-------|--------|
| Password auth via Better Auth | Pass |
| Min password length enforced server-side (≥8) | Pass |
| Password complexity enforced server-side | Fail (UI-only rules) |
| Email verification required | Fail (`requireEmailVerification: false`) |
| Password reset via email | Partial (needs Nodemailer + `BETTER_AUTH_URL`) |
| Social OAuth optional, linking disabled | Pass |
| Generic auth error messages | Pass |
| Credential stuffing / login rate limit | Fail (none in-app) |

**Finding — Security weakness**  
**Severity →** Medium  
**Evidence →** `lib/better-auth/auth.ts` min length only; `PASSWORD_VALIDATION` in `lib/constants.ts` is client-side; verification off.  
**Risk →** Weak passwords + unverified accounts.  
**Affected location →** Auth config + sign-up forms.  
**Why it matters →** Account quality and abuse.  
**Recommended fix →** Server-side complexity; enable verification for production.

---

## 2. Authorization / RBAC

| Check | Status |
|-------|--------|
| Per-user scoping on watchlist/alerts/trading proposals | Pass |
| Server actions never trust client `userId` for authz | Fail (`getBotDashboardData`) |
| Admin role for global model train/promote | Fail |
| Job-only helpers not exported as server actions | Fail (daytrader/forecast helpers) |
| Ingest restricted to worker identity | Partial (token optional) |

**Finding — Confirmed vulnerability**  
**Severity →** High  
**Evidence →** `getBotDashboardData(userId)` uses caller-supplied id; unauthenticated forecast/daytrader exports.  
**Risk →** IDOR + anonymous mutation/read of shared research data.  
**Affected location →** `lib/actions/daytrader.actions.ts`, `forecast.actions.ts`.  
**Why it matters →** Server actions are reachable HTTP endpoints.  
**Recommended fix →** Session binding; move cron helpers off `'use server'`; add admin RBAC.

---

## 3. Session / token

| Check | Status |
|-------|--------|
| Signed session via Better Auth | Pass |
| Middleware + layout defense | Partial (cookie presence + `getSession` in layouts) |
| Session revoke immediacy | Partial (5 min cookieCache) |
| Worker shared token | Partial (optional) |
| Inngest signing key | Partial (optional) |
| OAuth state/CSRF (provider) | Pass (Better Auth when enabled) |

**Finding — Security weakness**  
**Severity →** Medium  
**Evidence →** Cookie cache comment in `auth.ts`; middleware presence-only.  
**Risk →** Short window after revoke; false sense from middleware alone.  
**Recommended fix →** Shorter cache for sensitive ops; always `requireUserId` on actions.

---

## 4. Input validation

| Check | Status |
|-------|--------|
| Alert symbol/condition/price | Pass |
| Quotes symbol pattern + cap | Pass |
| Profile enums/country | Pass |
| Ingest payload schema hardening | Fail |
| Discord webhook URL allowlist | Fail |
| OpenInsider list name enum | Pass (worker) |

**Finding — Security weakness**  
**Severity →** Medium  
**Evidence →** Ingest `$set` largely trusts document fields; trading settings `Object.assign` for webhooks.  
**Risk →** Oversized/poisoned documents; notify SSRF.  
**Recommended fix →** Zod/schema validation; webhook allowlist.

---

## 5. Injection (NoSQL / command / HTML)

| Check | Status |
|-------|--------|
| Mongoose parameterized queries | Pass (typical ODM usage) |
| HTML escape in reset/proposal emails | Pass (`escapeHtml`) |
| Shell exec of user input | N/A (not found) |
| Mongo operator injection via raw body | Verify on ingest (objects assigned into `$set`) |

**Finding — Potential risk requiring verification**  
**Severity →** Low–Medium  
**Evidence →** Ingest copies `doc.*` / `f.*` into `$set` without stripping keys like `$`-prefixed operators in nested objects.  
**Risk →** Unexpected operator behavior if driver interprets nested keys.  
**Affected location →** ingest routes.  
**Recommended fix →** Explicit field allowlists; reject `$` keys.

---

## 6. XSS / CSRF

| Check | Status |
|-------|--------|
| React default escaping in UI | Pass (default) |
| `dangerouslySetInnerHTML` for user HTML | N/A / not found |
| TradingView `script.innerHTML` config | Partial (app-controlled JSON) |
| CSP | Fail |
| Server Actions CSRF (Next defaults) | Verify |

**Finding — Missing control**  
**Severity →** Medium  
**Evidence →** No CSP/security headers in `next.config.ts` / `vercel.json`.  
**Risk →** XSS impact larger if introduced.  
**Recommended fix →** CSP, `frame-ancestors`, HSTS at edge.

---

## 7. API security

| Check | Status |
|-------|--------|
| `/api/quotes` authenticated + capped | Pass |
| `/api/auth` via Better Auth | Pass |
| Ingest APIs fail closed | Fail |
| Consistent error shape without stack traces to client | Partial |
| API versioning / inventory docs | Partial (`API_DOCS.md`, marketing) |

**Finding — Confirmed vulnerability**  
**Severity →** High  
**Evidence →** Conditional token on ingest; see attack-surface §2.  
**Risk →** Open write if misconfigured.  
**Recommended fix →** Require token in production builds.

---

## 8. Rate limiting / abuse

| Check | Status |
|-------|--------|
| Quotes symbol cap | Pass |
| Scrapling per-domain throttle | Pass |
| OpenInsider list cache | Pass |
| Auth / server-action / Finnhub rate limits | Fail |
| Signup throttling | Fail |

**Finding — Missing control**  
**Severity →** High  
**Evidence →** No in-app rate limiter; unauthenticated expensive actions exist.  
**Risk →** Quota exhaustion / cost / DoS.  
**Recommended fix →** Edge rate limits; per-user budgets on Lab/forecast refresh.

---

## 9. File uploads

| Check | Status |
|-------|--------|
| User upload endpoints | N/A (none) |
| Safe handling if added later | Recommendation |

**Finding — Recommendation**  
Keep web uploads out; if needed: authz, size/type limits, storage isolation, malware scan.

---

## 10. Database

| Check | Status |
|-------|--------|
| URI from env | Pass |
| Credentials redacted in logs | Pass |
| Compose default password + published port | Fail |
| Encryption in transit (Atlas/TLS) | Verify (deploy) |
| Least-privilege DB user | Fail (root in compose) |
| Backups | Verify (ops) |

**Finding — Security weakness**  
**Severity →** Critical (exposed host)  
**Evidence →** `docker-compose.yml` `root`/`example`, `27017:27017`.  
**Risk →** Full breach.  
**Recommended fix →** Strong creds; internal network only; TLS; backups tested.

---

## 11. Secrets

| Check | Status |
|-------|--------|
| `.env` gitignored | Pass |
| `.env.example` placeholders only | Pass |
| No hardcoded live keys in source (scan) | Pass |
| Server-only trading/AI/Mongo secrets | Pass |
| Finnhub via `NEXT_PUBLIC_*` | Fail |
| Worker token required | Fail |
| Project store secrets filenames documented (names only) | Pass — see `secrets.md` |

**Finding — Security weakness**  
**Severity →** Medium  
**Evidence →** `NEXT_PUBLIC_FINNHUB_API_KEY` pattern.  
**Risk →** Browser key theft.  
**Recommended fix →** Server-only Finnhub keys.

(See `brain/security/secrets.md` for rotation table and Project store file names.)

---

## 12. Encryption

| Check | Status |
|-------|--------|
| TLS at edge | Verify (Vercel/proxy) |
| Password hashing | Pass (Better Auth) |
| Secrets encrypted at rest in Mongo (webhooks) | Fail |
| App-level field encryption | Fail |

**Finding — Missing control**  
**Severity →** Medium  
**Evidence →** Discord webhook URLs stored plaintext in `TradingSettings`.  
**Risk →** DB dump → webhook takeover.  
**Recommended fix →** Encrypt sensitive fields or use env-only webhooks.

---

## 13. CORS

| Check | Status |
|-------|--------|
| Custom wide-open CORS | N/A / not configured (Next defaults) |
| Explicit trusted-origin policy for actions | Verify |

**Finding — Recommendation**  
Document and verify Next 15 server-action origin checks in production; avoid adding `Access-Control-Allow-Origin: *` for credentialed APIs.

---

## 14. Dependencies

| Check | Status |
|-------|--------|
| Lockfile present | Pass |
| Automated dependency PRs | Fail (no Dependabot config) |
| Build fails on lint/type errors | Fail (`ignoreDuringBuilds` / `ignoreBuildErrors`) |
| Worker Python pins | Partial (`requirements.txt` present; audit Verify) |

**Finding — Missing control**  
**Severity →** Medium  
**Evidence →** `next.config.ts` ignores; `.github` lacks audit automation.  
**Risk →** Vulnerable deps ship.  
**Recommended fix →** CI `npm audit`/OSV; enable Dependabot; stop ignoring TS/ESLint in CI.

---

## 15. Logging / monitoring

| Check | Status |
|-------|--------|
| Auth failure logging without password | Pass |
| Mongo URI redaction | Pass |
| Central SIEM / alerting | Verify (ops) |
| Audit trail for orders | Pass (`OrderAudit`) |
| PII (email) in signup logs | Partial |

**Finding — Security weakness**  
**Severity →** Low  
**Evidence →** `auth.actions.ts` logs email on Inngest send.  
**Risk →** PII in app logs.  
**Recommended fix →** Hash/redact emails in logs; retain OrderAudit.

---

## 16. Admin

| Check | Status |
|-------|--------|
| Admin console | N/A / absent |
| Break-glass for kill switch | Partial (per-user kill switch exists) |
| Separation of Lab train vs end users | Fail |

**Finding — Missing control**  
**Severity →** Medium  
**Evidence →** No roles; any user can train/promote when signed in.  
**Risk →** Shared model sabotage.  
**Recommended fix →** Admin-only Lab mutations.

---

## 17. Deployment / infra

| Check | Status |
|-------|--------|
| Dockerized web + worker + mongo | Pass |
| Non-root containers | Fail (not set) |
| Secrets via env_file | Partial |
| Host-published Mongo/worker | Fail for shared hosts |
| Security headers at CDN | Fail / Verify |
| `ALPACA_ALLOW_LIVE` default false | Pass |
| `TRADING_UI_ENABLED` default false | Pass |

**Finding — Security weakness**  
**Severity →** High  
**Evidence →** Compose port publishes + default Mongo password + optional worker token.  
**Risk →** LAN/internet compromise of DB/worker.  
**Recommended fix →** Prod compose without host binds; reverse proxy; non-root USER.

---

## 18. Data privacy

| Check | Status |
|-------|--------|
| Terms page present | Pass (marketing `/terms`) |
| Email verification / consent flows | Partial |
| Minimize PII in forecasts | Pass (symbol-centric research data) |
| Third-party data sharing (Kit, analytics) | Partial / optional |
| Right-to-delete tooling | Fail (not found) |

**Finding — Missing control**  
**Severity →** Medium (jurisdictions vary)  
**Evidence →** No account-deletion flow found in actions.  
**Risk →** GDPR/CCPA operational gap.  
**Recommended fix →** Account delete + data purge runbook.

---

## 19. Error handling

| Check | Status |
|-------|--------|
| Auth actions return generic errors | Pass |
| Some APIs return `String(e)` to client | Partial (`getAlpacaAccountAction`) |
| Ingest 401/400 shapes | Pass |

**Finding — Security weakness**  
**Severity →** Low  
**Evidence →** Alpaca account action returns raw error string.  
**Risk →** Info leak about config/network.  
**Recommended fix →** Map to stable client error codes.

---

## 20. Backup / recovery

| Check | Status |
|-------|--------|
| Mongo volume defined | Pass (compose volume) |
| Documented restore drill | Fail / Verify ops |
| Secret rotation runbook | Partial (`secrets.md` rotation table) |
| Trading kill switch | Pass (per user) |

**Finding — Recommendation**  
**Severity →** Medium (ops)  
**Evidence →** Volume only; no in-repo backup automation.  
**Risk →** Data loss after incident.  
**Recommended fix →** Automated Mongo backups + restore test; keep kill switch + `ALPACA_ALLOW_LIVE=false` as financial backstops.

---

## Quick scorecard (codebase)

| Area | Overall |
|------|---------|
| Authn basics | Partial |
| Authz / IDOR | Fail |
| Secrets hygiene (repo) | Partial |
| Trading financial controls | Pass (with env discipline) |
| Ingest / worker | Fail if token unset |
| Hardening (headers, rate limit, RBAC, CI) | Fail |
| Privacy / backups | Partial / ops Verify |

---

## Related docs

- `brain/security/threat-model.md`
- `brain/security/secrets.md`
- `brain/security/attack-surface.md`
