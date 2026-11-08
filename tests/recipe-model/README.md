# Recipe-model corpus and baseline (M1)

This corpus measures how well RecipeBox turns a source into the structured
recipe model of ADR 0012, with the review rules of ADR 0014 and the attribution
rules of ADR 0020. It measures **structure**, not just "did the import
succeed". It costs **$0**: nothing here calls a network service or an AI model.

```sh
node scripts/recipe-model/scorer-test.js   # 18 tests: the scorer detects and classifies each failure
node scripts/recipe-model/eval.js          # scores everything; fails if results differ from baseline.json,
                                           # if the reference output has any finding, or if a second run differs
node scripts/recipe-model/eval.js --write-baseline   # re-record after an intended change (review the diff)
```

## Detection versus modification

Every finding is classed in one of two ways:

- **Detection failure:** the output didn't *notice or express* something. The
  recipe the cook reads is still what the source said. Examples: a missing link,
  portion or flag; the wrong section; missing attribution; a preparation filed as
  something to buy.
- **Modification:** the output *changed the recipe*. Examples: a quantity
  altered, invented, dropped or turned into a float; an ingredient added or lost;
  step wording rewritten; a contradiction settled silently; a reference that
  points at nothing.

Modifications are the dangerous class. The two are reported separately so an
improvement in one can never hide a regression in the other.

## What is scored

| Failure class | Measured by | Cases |
| --- | --- | --- |
| Ingredient-to-instruction references | link recall and precision; wrong links | all cases with steps |
| Invalid references | references to nothing (modification) | scorer tests; 3 found in recorded outputs |
| Split quantities | step portions correct | `divided-butter-bars`, `eggs-divided-wash`, `marinade-reserved`, `pumpkin-pudding`, `chocolate-ice-cream` |
| Prepared mixtures / components | preparations not listed as ingredients | `pumpkin-pudding`, `chocolate-ice-cream`, `marinade-reserved`, `frosting-headers-in-list`, `structured-cookies`, `eggs-divided-wash`, `divided-butter-bars`, `lemon-tart-sections` |
| Wrong section | ingredients in the right section | `lemon-tart-sections`, `frosting-headers-in-list`, `chocolate-ice-cream` |
| Missing / ambiguous quantities | invented quantities (modification); unreadable not flagged (detection) | `ambiguous-quantities`, `low-confidence-card`, `pumpkin-pudding` |
| List and directions contradict | surfaced, kept but unflagged (detection), or settled silently (modification) | `flour-contradiction`, `low-confidence-card` |
| Floating-point artefacts | quantities as written; float artefacts | `fraction-fidelity`, `structured-cookies`; recorded-output audit |
| Source attribution | source fields captured | `source-attribution-blog`, `structured-cookies`, `divided-butter-bars`, `video-source` |
| AI adjustment validation | validator verdicts | `adjustments/crumble-bars.adjust.json` (13 candidates) |
| Step wording preserved | `keep` phrases (times, temperatures, pan sizes, quantities) still present | most structured cases |
| Substitution applied by the importer | ingredient dropped plus invented | `substitution-in-notes` |

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
      "steps": [{ "key": "c1", "cue": "pulse the flour", "keep": ["350°F", "15 minutes"],
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
- `cue` is a phrase unique to the step's text. If a normaliser removes small
  words, the step still matches when all the cue's content words are present.
- `keep` lists phrases that must survive in the step: times, temperatures, pan
  sizes, quantities.
- `allowedExtras` lists output ingredient names that are not counted as
  invented.
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
