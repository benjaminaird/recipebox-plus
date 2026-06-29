# Vercel + Supabase Migration Notes

RecipeBox can run on Vercel with the existing Express API through `api/index.js`.
The app still supports local development with `npm start`.

## Vercel project settings

- Framework preset: Other
- Build command: leave empty or use `npm install`
- Output directory: leave empty
- Install command: `npm install`

## Required Vercel environment variables

- `ANTHROPIC_API_KEY`: server-side Anthropic key for AI extraction.
- `DATABASE_URL`: Supabase Postgres connection string.
- `YOUTUBE_API_KEY`: optional, but recommended for YouTube metadata fallback.

Use Supabase's pooled connection string for Vercel/serverless if available.

## Supabase first-pass setup

1. Create a Supabase project.
2. Open SQL Editor.
3. Run `docs/supabase-setup.sql`.
4. Copy the Postgres connection string into Vercel as `DATABASE_URL`.
5. Deploy RecipeBox on Vercel.
6. Visit `/api/health`; `database` should be `true`.

This first pass keeps RecipeBox on the current shared `recipebox_store` table.
The same SQL file also creates account-ready tables and RLS policies for the next iteration, but the UI is not using those tables yet.

## Next iteration

- Add Supabase Auth to the frontend.
- Move recipes from local/shared JSON storage to per-user `recipes.recipe_json`.
- Move meal planning to `meal_plans.plan_json`.
- Move timer sound and user preferences to `user_settings.settings_json`.
- Add Supabase Storage for hero images, recipe screenshots, PDFs, and handwritten-card uploads.
