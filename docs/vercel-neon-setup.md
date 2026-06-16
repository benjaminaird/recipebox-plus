# Vercel + Neon Setup

RecipeBox is prepared for Vercel through `vercel.json` and `api/index.js`.
The app still supports local development with `npm start`.

## Recommended first-pass setup

Use Vercel for hosting and Neon for Postgres. This avoids using another
Supabase free project slot.

## Required environment variables

- `ANTHROPIC_API_KEY`: server-side Anthropic key for AI extraction.
- `DATABASE_URL`: Neon Postgres pooled connection string.
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
- Users create an account with an email address.
- RecipeBox generates a private sync code that is shown once before the user
  continues into the app.
- The server stores only a salted hash of that sync code.
- Sessions use an HTTP-only `rb_session` cookie with a long rolling expiration,
  so users stay signed in unless they sign out from Settings.
- Signed-in recipe and meal plan data is stored by `user_id` in Neon.
- Signed-out users return to the sign-in/create-account screen.

This is intentionally a bridge to a fuller auth provider. For v1, replace the
sync-code sign-in layer with Neon Auth or Clerk, then keep using the same
`recipes`, `meal_plans`, and `user_settings` tables with provider user IDs.
