# recipebox-plus
RecipeBox+ app

## Environment variables

- `ANTHROPIC_API_KEY`: enables AI recipe extraction.
- `DATABASE_URL`: enables PostgreSQL persistence.
- `YOUTUBE_API_KEY`: optional but recommended for YouTube imports. Used server-side as a fallback to fetch video title, thumbnail, and description through the YouTube Data API when Render cannot access transcript/description data from YouTube pages.
