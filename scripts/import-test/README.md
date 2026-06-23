# RecipeBox Import Test Harness

This harness checks import readiness against the same source-prep paths the app uses:

- URL recipes through `/api/fetch-url`
- YouTube through `/api/transcript`
- Social links through `/api/fetch-social`
- PDF text extraction with `pdfjs-dist`
- Recipe-card photos/screenshots as image inputs

## Safe Estimate

From the repo root:

```sh
npm run import-test:estimate
```

Estimate mode spends `$0`. It prepares each source, writes `scripts/import-test/out/report.html`, and estimates the maximum AI cost for a live run. Placeholder social sources are skipped by default.
Sources marked `skipByDefault` are also skipped by default; use that for known-low-quality fixtures that need replacement.

Useful focused runs:

```sh
npm run import-test:estimate -- --only=url
npm run import-test:estimate -- --only=pdf,photo
npm run import-test:estimate -- --include-skipped --only=youtube
```

URL, YouTube, and social estimates need the RecipeBox server running locally:

```sh
npm start
```

## Live Extraction

Live mode calls Anthropic and should only be run with a small budget cap:

```sh
ANTHROPIC_API_KEY=sk-ant-... npm run import-test:run -- --budget=4
```

The harness hard-stops before a call that could exceed the budget.

## Adding Sources

For public/non-sensitive fixtures, edit `manifest.json`.

For real customer, family, Desktop, or otherwise private fixtures, create `manifest.local.json`. The harness automatically prefers `manifest.local.json` when it exists, and git ignores it along with the private Desktop fixture folders.

- Replace placeholder social URLs before using `--include-placeholders`.
- Replace skipped YouTube fixtures with public videos that expose enough transcript or description text to extract a real recipe.
- Add real photos/screenshots under `sources/photos/`.
- Add real PDFs under `sources/pdfs/`.
- Add `groundTruthFile` for automatic scoring when you have expected ingredients/steps.
