# recipebox
RecipeBox app

## Environment variables

- `ANTHROPIC_API_KEY`: enables AI recipe extraction.
- `DATABASE_URL`: enables PostgreSQL persistence. For Vercel, use the Supabase pooled connection string if available.
- `YOUTUBE_API_KEY`: optional but recommended for YouTube imports. Used server-side as a fallback to fetch video title, thumbnail, and description through the YouTube Data API when Render cannot access transcript/description data from YouTube pages.

## Vercel + Supabase

RecipeBox is prepared for Vercel through `vercel.json` and `api/index.js`.

For Supabase setup, run `docs/supabase-setup.sql` in the Supabase SQL Editor, then add the required environment variables in Vercel. See `docs/vercel-supabase-migration.md` for the checklist.
