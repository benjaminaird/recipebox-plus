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

## Deeper accuracy analysis

A live run also records the full structured recipe and (for text-based sources)
the exact source text fed to the model, so we can check far more than "were the
right ingredients listed?":

```sh
node scripts/import-test/analyze.js <tag>     # e.g. analyze.js deep
```

It reports, per import and in aggregate:

- **over-extraction / hallucination** — extracted ingredients whose key nouns
  never appear in the source (text modes).
- **amount grounding** — distinctive quantities (fractions, multi-digit, ranges)
  the model wrote that aren't in the source (unicode fractions normalized).
- **substitution audit** — high-signal ingredients present in source but missing
  from the recipe (mirrors the app's `findSourceIngredientMismatches`, including
  same-product equivalence; skips blog-noisy `url` pages).
- **structural integrity** — step `ingredientRefs` resolve, no empty names.
- **servings / macros sanity** — positive integer servings, non-zero per-serving
  macros (both promised by the prompt).

## Comparing models / regression gate

```sh
node scripts/import-test/compare.js haiku sonnet opus   # side-by-side recall/title/cost
node scripts/import-test/gate.js <tag>                  # fail (exit 1) if a run regressed vs baseline.json
node scripts/import-test/gate.js --save <tag>           # (re)write baseline.json from a known-good run
```

The harness model + pricing are overridable for A/B testing the same pipeline:
`--model=`, `--price-in=`, `--price-out=`, `--out=<tag>`. `EXTRACT_PROMPT` is read
live from `src/app.jsx` so the test can never drift from production.

Typical workflow after a prompt change:

```sh
npm start                                                  # scrapers
node scripts/import-test/run.js --run --out=check --only=url,pdf,text
node scripts/import-test/gate.js check                     # blocks accuracy regressions
```

## Adding Sources

For public/non-sensitive fixtures, edit `manifest.json`.

For real customer, family, Desktop, or otherwise private fixtures, create `manifest.local.json`. The harness automatically prefers `manifest.local.json` when it exists, and git ignores it along with the private Desktop fixture folders.

- Replace placeholder social URLs before using `--include-placeholders`.
- Replace skipped YouTube fixtures with public videos that expose enough transcript or description text to extract a real recipe.
- Add real photos/screenshots under `sources/photos/`.
- Add real PDFs under `sources/pdfs/`.
- Add `groundTruthFile` for automatic scoring when you have expected ingredients/steps.
