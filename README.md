# recipebox
RecipeBox app

## Environment variables

- `ANTHROPIC_API_KEY`: enables AI recipe extraction.
- `DATABASE_URL`: enables PostgreSQL persistence. For Vercel, use the Neon pooled connection string.
- `YOUTUBE_API_KEY`: optional but recommended for YouTube imports. Used server-side as a fallback to fetch video title, thumbnail, and description through the YouTube Data API when Render cannot access transcript/description data from YouTube pages.

## Vercel + Neon

RecipeBox is prepared for Vercel through `vercel.json` and `api/index.js`.

For Neon setup, add the Neon pooled connection string as `DATABASE_URL` in Vercel. The app creates its current shared `recipebox_store` table automatically on first boot. See `docs/vercel-neon-setup.md` for the checklist.
