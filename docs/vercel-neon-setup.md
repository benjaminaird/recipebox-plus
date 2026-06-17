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
- Existing local recipes are synced only when the user chooses to add this
  device's recipes to the account.
- Sessions use an HTTP-only `rb_session` cookie with a long rolling expiration,
  so users stay signed in unless they sign out from Settings.
- Signed-in recipe and meal plan data is stored by `user_id` in Neon.
- Signed-out users return to the sign-in/create-account screen.

This is intentionally a bridge to a fuller auth provider. For v1, consider
replacing the in-app password layer with Neon Auth or Clerk, then keep using the
same `recipes`, `meal_plans`, and `user_settings` tables with provider user IDs.
