# RecipeBox Production Security Audit

Date: June 17, 2026

## Security Findings Summary

RecipeBox currently runs as a Vercel-hosted Express app with Neon Postgres and
server-side Anthropic calls. The app is not currently wired to Supabase for
RecipeBox production data, so Supabase RLS/storage hardening is documented as a
future migration checklist rather than applied to a live Supabase project.

### Findings Before This Pass

- AI calls were already backend-only through `/api/ai`; no Anthropic key was
  present in the frontend bundle.
- Account sessions were server-issued HTTP-only cookies.
- Recipe and meal-plan reads/writes were scoped by the authenticated `user_id`.
- Master Admin endpoints used `requireAuth` and `requireMasterAdmin`.
- App Control edits were typed knowledge records, not raw code execution.
- Missing production hardening:
  - No dedicated entitlement summary endpoint.
  - No backend-owned entitlement/billing tables.
  - No protected persistent rate-limit counters.
  - Limited AI usage event logging.
  - No global AI kill switches or budget caps.
  - No written native/store/RLS checklist.
  - App Control mobile layout could overflow horizontally.

## Implemented This Pass

- Added security headers:
  - `X-Content-Type-Options`
  - `Referrer-Policy`
  - `Permissions-Policy`
  - `X-Frame-Options`
  - `Cross-Origin-Resource-Policy`
- Added backend-owned tables:
  - `user_entitlements`
  - `subscription_events`
  - `rate_limit_counters`
  - `ai_usage_events`
- Added sanitized entitlement endpoint:
  - `GET /api/me/entitlements`
- Hardened `/api/ai`:
  - requires authenticated user
  - detects AI feature class
  - checks backend entitlements
  - checks per-IP daily rate limit
  - checks per-user daily rate limit
  - checks monthly AI allowance
  - supports master-admin unlimited bypass
  - supports global AI kill switch
  - supports import/adjust kill switches
  - supports global daily request cap
  - supports monthly estimated cost cap
  - logs AI events with request id, feature, model, tier, success/failure,
    token counts when available, and estimated cost
- Kept admin role changes backend-only.
- Added App Control mobile overflow fixes.

## Backend-Only AI Status

Frontend calls only internal RecipeBox endpoints. Anthropic API keys are read
only from server environment variables. The frontend does not expose Anthropic,
Stripe, Vercel, WhatsNext, or admin secrets.

Current endpoint:

- `POST /api/ai`

Future endpoint split:

- `POST /api/ai/import-recipe`
- `POST /api/ai/adjust-recipe`
- `POST /api/ai/pantry-chef`
- `POST /api/ai/chat-editor`

The split is held for a later refactor so existing import, Pantry Chef, and
AI-adjust flows are not broken.

## User Data Isolation

Current Neon-backed user-owned data:

- `recipes.user_id`
- `meal_plans.user_id`
- `user_settings.user_id`
- account sessions and reset tokens tied to `profiles.user_id`

Server routes use `currentUser(req)` and scope reads/writes to `user.user_id`.
Users cannot submit a different `user_id` to read or write another account's
recipes or meal plan.

## Entitlement And Billing Protection

Frontend does not write plan, role, subscription, Stripe IDs, AI usage, or
rate-limit tables. These are backend-owned:

- `profiles.role`
- `user_entitlements`
- `subscription_events`
- `ai_usage_monthly`
- `ai_usage_events`
- `rate_limit_counters`
- App Control sources and logs

No billing provider is configured yet, and the provider is platform-dependent —
**not necessarily Stripe**. Apple/Google require their own in-app billing for
digital goods sold inside a native app:

- **Native iOS** → StoreKit / In-App Purchase (Stripe for in-app digital goods
  violates App Store Guideline 3.1.1). Verify the App Store receipt server-side.
- **Native Android** → Google Play Billing. Verify the purchase token server-side.
- **Web** → Stripe (verify webhook signatures) only if/when there is a web checkout.

Security invariants are identical regardless of provider:

- The backend entitlement is the single source of truth; a purchase only takes
  effect after a **server-side-verified** signal (Apple/Google receipt or Stripe
  webhook), which sets the plan or writes a `purchase` ledger grant.
- Never trust client-submitted plan, price, status, receipt, or usage values.
- Store provider transaction/customer IDs server-side (`user_entitlements`
  already has `stripe_customer_id`/`stripe_subscription_id`; add IAP transaction
  fields or a `purchases` table when native ships).
- Map provider product/price IDs to backend entitlement plans server-side.

## Master Admin Audit

Current controls:

- Master Admin is stored server-side as `profiles.role = 'master_admin'`.
- Admin APIs are under `/api/admin/*`.
- Admin APIs require `requireAuth` and `requireMasterAdmin`.
- App Control edits are typed, validated records.
- App Control cannot edit raw JS, HTML, SQL, shell commands, environment
  variables, auth settings, or API keys.
- App Control changes are logged in `app_control_change_log`.
- Rollback exists for knowledge-source changes.
- Master Admin bypasses AI limits but still uses backend sessions.

Held for later:

- Extra confirmation UI for high-impact App Control categories.
- Two-person approval or re-auth for very sensitive changes.
- Separate audit export page.

## Supabase RLS Checklist For Future Migration

RecipeBox production data is currently Neon-backed, not Supabase-backed. If
RecipeBox moves to Supabase tables, every user-owned table must have:

- `user_id uuid not null`
- RLS enabled
- `SELECT` policy: `auth.uid() = user_id`
- `INSERT` policy: `with check (auth.uid() = user_id)`
- `UPDATE` policy: `using (auth.uid() = user_id) with check (auth.uid() = user_id)`
- `DELETE` policy: `using (auth.uid() = user_id)`

Tables that must not be writable from normal users:

- roles/admin fields
- plans/subscriptions
- entitlement limits
- AI usage counters/events
- rate-limit counters
- billing IDs
- Stripe customer/subscription IDs
- App Control config
- admin logs

## Supabase Storage Checklist For Future Migration

Recommended private path:

```text
recipe-photos/{user_id}/{recipe_id}/{filename}
```

Policies:

- user reads only own folder
- user uploads only own folder
- user updates/deletes only own folder
- no public list access
- use signed URLs or server-mediated access for private photos

## Manual Setup Still Required

- Configure Stripe or App Store / Google Play billing when subscriptions begin.
- Add real native iOS/Android projects.
- Add Apple Sign In and Google Sign In.
- Add crash reporting only after privacy disclosures are updated.
- Add Supabase RLS/storage policies only if RecipeBox moves to Supabase.
- Decide production AI global caps:
  - `AI_DAILY_GLOBAL_MAX_REQUESTS`
  - `AI_MONTHLY_GLOBAL_MAX_COST_USD`
- Set emergency AI disable reason if needed.

---

# Red-Team & Stability Hardening Pass

Date: June 26, 2026

A controlled, non-destructive security and stability audit performed before web
beta. The reviewer acted adversarially against an authorized local/dev copy
only: no destructive tests against production, no secret exfiltration, no DoS,
no brute-forcing real accounts, no third-party attacks. Production checks were
read-only.

## Attack Surface Reviewed

- **Auth & sessions** — scrypt + `timingSafeEqual` passwords, DB-backed sessions
  (`account_sessions`), hashed single-use expiring reset/verify tokens,
  non-enumerating sign-in/reset responses, DB-backed auth rate limiting
  (`rate_limit_counters`, per IP+email, 20 / 15 min, shared across serverless
  instances).
- **Data isolation (IDOR)** — every recipe / meal-plan / settings read and write
  is scoped to `currentUser(req).user_id`; client-supplied `user_id` is never
  trusted. Confirmed no route accepts an arbitrary owner id.
- **Entitlements / AI credits / billing** — server-authoritative; no client can
  set tier, role, credits, or usage. Repair passes non-billable; failed/blocked
  calls cost zero; spend order monthly → bonus → purchased.
- **Admin surface** — all `/api/admin/*` routes gated by `requireAuth +
  requireMasterAdmin`; App Control edits are typed records, never raw code/SQL.
- **SSRF** — user-controlled import URLs validated by `assertPublicHost` (+
  `isPrivateIp`, redirect re-validation, `fetchWithTimeout`, `readBodyCapped`).
- **XSS** — React rendering; no `dangerouslySetInnerHTML` recipe sinks. Note
  links render with `rel="noreferrer"` + `target="_blank"`.
- **Client persistence** — localStorage mirror of recipes / meal plan / shopping
  list / pantry.

## Findings & Fixes

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | High | **Host-header injection in email links.** Verification and password-reset URLs were built from the request `Host` / `X-Forwarded-Host` header, which an attacker can spoof to send a victim a link pointing at an attacker-controlled origin (token-stealing phishing). | New `trustedAppOrigin(req)`: prefers `APP_BASE_URL`, honours only `localhost`/`127.0.0.1` for dev, and otherwise pins to the production origin regardless of the inbound Host. Both email links now use it. |
| 2 | Medium | **Client-controlled AI model / `max_tokens`.** The `/api/ai` proxy forwarded the client body verbatim, so a caller could request an expensive model or a huge output, inflating cost. | New `sanitizeAiBody()`: coerces `model` to an allowlist (`DEFAULT_AI_MODEL` otherwise) and clamps `max_tokens` to `[1, 8000]` (sane default 4096). `messages`/`system` pass through untouched. |
| 3 | Medium | **Octal/hex/decimal-encoded-IP SSRF bypass.** `0177.0.0.1`, `2130706433`, `0x7f000001` could resolve to loopback yet slip past the post-resolution check. | `assertPublicHost` now rejects numeric/octal/hex host encodings **before** DNS, deterministically. |
| 4 | Low (stability) | **localStorage tamper / corruption blank-screen.** A tampered or wrong-typed persisted value (valid JSON of the wrong shape) could make `recipeIds.map(...)` throw and white-screen the app. | Added `sanitizeShoppingList` / `sanitizePantry` / `emptyShoppingList` (in `public/shopping-list.js`) and guarded `loadRecipes` / `loadMealPlan` parsing in `src/app.jsx`. Bad inputs always yield the correct shape. |

No Critical findings. No schema or production-data changes were made.

## Tests Added / Extended

- `scripts/security-hardening-test.js` (new) — `sanitizeAiBody` clamping +
  `trustedAppOrigin` host-spoof resistance.
- `scripts/shopping-list-test.js` — localStorage tamper/corruption resilience
  (non-array/string/object inputs always sanitize to the correct shape;
  `recipeIds.map` never throws; non-object manual items dropped; pantry keeps
  only strings).
- `scripts/import-reliability-test.js` — encoded-IP SSRF block cases
  (decimal / hex / octal-labeled / hex-labeled loopback).

Full suite (15 scripts) green; `node -c server.js`, `node --check
public/app.js`, and the esbuild bundle build clean.

## Residual Risk / Known Limitations

- **localStorage is client-trusted by design.** The mirror is a convenience cache
  for offline/guest use; the server remains the source of truth for signed-in
  users. Sanitizers prevent crashes but cannot guarantee the *integrity* of a
  value a user tampered with in their own browser.
- **CSP is still report-only** (see `vercel.json`). Promotion to enforcing is
  the next launch-gate item; the report-only policy already covers the key
  source directives and `connect-src` is not a blanket `https:`.
- **AI model allowlist is static.** When a new model is adopted, add it to
  `ALLOWED_AI_MODELS` (otherwise calls silently fall back to the default).

## Not in Scope / Deferred

- Stripe/webhook signature verification (billing not yet live).
- Supabase RLS/storage policies (RecipeBox data is Neon-backed).
- Two-person approval / re-auth for high-impact App Control changes.
