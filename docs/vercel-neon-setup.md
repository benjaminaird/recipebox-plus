# Vercel + Neon Setup

RecipeBox is prepared for Vercel through `vercel.json` and `api/index.js`.
The app still supports local development with `npm start`.

## Recommended first-pass setup

Use Vercel for hosting and Neon for Postgres. This avoids using another
Supabase free project slot.

## Required environment variables

- `ANTHROPIC_API_KEY`: server-side Anthropic key for AI extraction.
- `DATABASE_URL`: Neon Postgres pooled connection string.
- `RESEND_API_KEY`: Resend API key for password reset emails.
- `RESEND_FROM`: sender identity for password reset emails, for example
  `RecipeBox <hello@yourdomain.com>`.
- `APP_BASE_URL`: production app URL used in password reset links, for example
  `https://recipebox-kappa.vercel.app`.
- `AI_MONTHLY_LIMIT`: optional monthly AI request limit per user. Defaults to
  `50` when unset.
- `DEFAULT_ACCOUNT_PLAN`: optional default plan for accounts without an
  explicit entitlement row. Defaults to `beta`.
- `AI_FEATURES_ENABLED`: set to `false` to pause all non-admin AI calls.
- `AI_IMPORTS_ENABLED`: set to `false` to pause AI import calls.
- `AI_ADJUST_ENABLED`: set to `false` to pause AI adjustment calls.
- `AI_DAILY_GLOBAL_MAX_REQUESTS`: optional global daily request cap.
- `AI_MONTHLY_GLOBAL_MAX_COST_USD`: optional global monthly estimated AI cost
  cap.
- `AI_EMERGENCY_DISABLE_REASON`: user-facing reason shown when AI is disabled.
- `MASTER_ADMIN_EMAIL`: optional master admin email for App Control access.
- `MASTER_ADMIN_PASSWORD_HASH`: preferred master admin password hash generated
  by RecipeBox's `scrypt$salt$hash` format.
- `MASTER_ADMIN_PASSWORD`: fallback plain-text bootstrap password. Use only
  long enough to create or promote the master account, then replace with
  `MASTER_ADMIN_PASSWORD_HASH`.
- `MASTER_ADMIN_NAME`: optional display name for the master admin profile.
- `NATIVE_APP_ORIGIN`: optional trusted origin for a future native shell if it
  is not one of the built-in RecipeBox web origins.
- `YOUTUBE_API_KEY`: optional, but recommended for YouTube metadata fallback.

## Vercel project settings

- Framework preset: Other
- Install command: `npm install`
- Build command: leave blank
- Output directory: leave blank

## Neon setup

The current app can create its own `recipebox_store` table when it starts with
`DATABASE_URL` set. If you want to pre-create the table and future account-ready
tables, run `docs/neon-setup.sql` in Neon SQL Editor.

## Verification

After deployment, visit:

```text
https://YOUR-VERCEL-APP.vercel.app/api/health
```

Expected:

```json
{ "status": "ok", "database": true }
```

If `database` is `false`, Vercel is missing `DATABASE_URL` or the Neon
connection string is incorrect.

## Next auth iteration

RecipeBox now has a first-pass account sync prototype:

- Users must sign in or create an account before entering the app.
- Users create an account with an email address and password.
- The server stores only a salted password hash.
- Passwords require at least 6 characters with no complexity rules.
- Auth endpoints have a lightweight per-IP/email attempt limit to slow guessing.
- Password reset uses one-hour email links sent through Resend.
- Signed-in users can change their password from Settings after confirming
  their current password.
- Users can delete their account from Settings after confirming their password.
- AI requests are counted per signed-in user per month, with a configurable
  beta limit shown in Settings.
- AI requests also pass backend-only entitlement, per-user, per-IP, and optional
  global kill-switch checks before the provider call.
- AI usage events are logged with request id, feature, model, tier, success
  state, token counts when available, and estimated cost.
- Master admin accounts can open App Control, bypass monthly AI limits, and
  manage typed knowledge sources. Normal users cannot access admin endpoints.
- App Control changes are logged in `app_control_change_log` and knowledge
  sources are validated before being saved.
- Existing local recipes are synced only when the user chooses to add this
  device's recipes to the account.
- Sessions use an HTTP-only `rb_session` cookie with a long rolling expiration,
  so users stay signed in unless they sign out from Settings.
- Signed-in recipe and meal plan data is stored by `user_id` in Neon.
- Signed-out users return to the sign-in/create-account screen.

This is intentionally a bridge to a fuller auth provider. For v1, consider
replacing the in-app password layer with Neon Auth or Clerk, then keep using the
same `recipes`, `meal_plans`, and `user_settings` tables with provider user IDs.
