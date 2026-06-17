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

Stripe is not configured yet. Required future work:

- Store Stripe customer ID server-side.
- Store Stripe subscription ID server-side.
- Verify Stripe webhook signatures.
- Process subscription created/updated/deleted events.
- Process failed payments.
- Map Stripe price IDs to backend entitlement plans.
- Never trust client-submitted plan, price, status, or usage values.

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
