# Recipe-model corpus and baseline (M1)

This corpus measures how well RecipeBox turns a source into the structured
recipe model of ADR 0012, with the review rules of ADR 0014 and the attribution
rules of ADR 0020. It measures **structure**, not just "did the import
succeed". It costs **$0**: nothing here calls a network service or an AI model.

```sh
node scripts/recipe-model/scorer-test.js   # proves the scorer detects each failure class
node scripts/recipe-model/eval.js          # scores everything; fails if results differ from baseline.json
node scripts/recipe-model/eval.js --write-baseline   # re-record after an intended change (review the diff)
```

## What is scored

| Failure class | Metric | Case(s) |
| --- | --- | --- |
| Split ingredient quantities | step portions correct | `divided-butter-bars`, `pumpkin-pudding`, `chocolate-ice-cream` |
| Prepared mixtures and intermediate components | preparations not listed as ingredients | `pumpkin-pudding`, `chocolate-ice-cream`, `divided-butter-bars`, `lemon-tart-sections` |
| Incorrect ingredient-to-step references | step links precision and recall | every case with steps |
| Missing or ambiguous quantities | quantities not invented; unreadable quantities flagged | `ambiguous-quantities`, `low-confidence-card`, `pumpkin-pudding` |
| Ingredient-section confusion | ingredients in the right section | `lemon-tart-sections`, `chocolate-ice-cream` |
| Contradictory source information | contradictions surfaced, not silently resolved | `flour-contradiction`, `low-confidence-card` |
| Recipe adjustments and substitutions | validator verdicts | `adjustments/crumble-bars.adjust.json` (9 candidates) |
| Source preservation | source fields captured (cleaned URL, site, original title, author) | `source-attribution-blog`, `divided-butter-bars` |
| Import-review uncertainty | unknown fields left blank; unreadable values flagged | `pumpkin-pudding`, `ambiguous-quantities`, `low-confidence-card` |

Quantity fidelity also checks that amounts keep the source's wording: a source's
`1/4` must not come back as `0.25`, and `2 1/3` must not come back as
`2.3333332538605`.

## Subjects

- **extractor:** today's deterministic JSON-LD/microdata path
  (`public/recipe-extract.js`), plus the app's `sourceUrl` assignment. It runs
  only on HTML cases.
- **reference:** the ideal target-model output built from each case's truth. It
  must score 100%, or the run fails as a scorer bug.
- **Paid AI paths** (pasted text, photos, AI fallback): **not run**. They are
  listed under `pendingPaid` until a spend budget is agreed (ADR 0017). Responses
  will be cached by case, model and effort, and scored offline, so rescoring
  never spends twice.
- **Recorded outputs audit:** a structural audit of the 91 production-pipeline
  outputs already committed under `tests/results/imports/nightmare-debug`. It
  reports counts and case ids only.

## Case format (`cases/<id>.case.json`)

```jsonc
{
  "id": "pumpkin-pudding",
  "provenance": "Synthetic, authored for RecipeBox …",   // always say where the text came from
  "categories": ["preparation", "split-quantity"],
  "input": { "kind": "html", "file": "x.html", "url": "https://…" }   // or { "kind": "text", "text": "…" }
  "truth": {
    "servings": "8" | null,
    "blank": ["servings", "macros"],                       // must stay empty (ADR 0014)
    "sections": [{
      "key": "crust", "match": ["crust"], "anySection": false,
      "ingredients": [{ "key": "butter", "match": ["butter"], "amount": "1/2", "unit": "cup",
                        "divided": true, "optional": false, "unreadable": false }],
      "steps": [{ "key": "c1", "cue": "pulse the flour",
                  "uses": [{ "ing": "butter", "amount": "1/4", "unit": "cup" }, { "ing": "flour" }] }]
    }],
    "preparations": [{ "key": "dough", "match": ["dough"], "producedBy": "c1", "usedBy": ["c2"] }],
    "contradictions": [{ "ing": "flour", "values": ["1 cup", "2 cups"] }],
    "source": { "url": "…", "siteName": "…", "originalTitle": "…", "author": "…" }
  }
}
```

- `match` lists lower-case substrings that identify an ingredient, section or
  preparation in an output.
- `cue` is a phrase unique to the step's text.
- A `uses` entry with an `amount` is a portion.

## Public and private material

- **Public cases** (`cases/`) are **synthetic**. They are written for RecipeBox
  or use reserved `.example` domains, and contain no copied recipe text.
- **Pumpkin pudding and chocolate ice cream** are **synthetic stand-ins** that
  reproduce the reported failure classes. When the real recipes are supplied,
  they go in `private/` unless you choose to publish them.
- **Real recipe cards, photos, screenshots and personal sources** go in
  `private/` (see its README), which git ignores.
- Third-party recipe pages are referenced by URL only, as the nightmare
  manifest's rules require.
