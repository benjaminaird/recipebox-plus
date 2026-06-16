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

The included `docs/neon-setup.sql` account tables use `user_id text` so they can
work with Neon Auth, Clerk, Auth.js, or another provider. Once auth is selected,
wire API reads/writes to the authenticated user instead of the current shared
`recipebox_store` keys.
