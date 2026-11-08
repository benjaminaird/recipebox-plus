# M1: Recipe Intelligence Baseline (engineering plan)

Status at 2026-11-08: **the $0 harness and baseline exist** (`tests/recipe-model/`,
`scripts/recipe-model/`). The paid bake-off has not run. Spec sources: ADR 0012,
0014, 0016, 0017, 0020, and `docs/recipe-model-investigation.md`.

## 1. Inventory of existing fixtures

| Asset | Size | What it measures | Gap for M1 |
| --- | --- | --- | --- |
| `scripts/import-test/fixtures/*.html` + `.truth.json` | 5 HTML pages | Title, servings, step count, ingredient names | No links, portions, sections, preparations or source |
| `scripts/import-test/cards/*` | 2 synthetic cards | Photo import readability | No structural truth |
| `tests/fixtures/imports/nightmare-recipes/manifest.json` | 100 real URLs | Import succeeded and preservation notes; "URLs only" rule | Truth is prose (`preserve_notes`), not machine-checkable structure |
| `tests/results/imports/nightmare-debug/*/normalized.json` | 91 recorded outputs | The production pipeline's actual output | No truth; usable for structural audit only |
| Domain unit tests (7 scripts) | — | Module behaviour | No corpus-level scoring |

Existing edge-case tags in the nightmare set touch our categories: *multiple
components* (4), *substitutions* (5), *optional toppings* (6), *ingredient
sections* (3), *to taste* (4). But nothing scores them structurally, and there
are **no** contradiction, step-link, portion, preparation or source-attribution
expectations anywhere.

## 2. What the baseline already proves (no AI spend)

**Deterministic extractor** (structured-data pages, which the app imports free):

| Measure | Today |
| --- | --- |
| Ingredients found, quantities correct and as written | 100% (22/22, 21/21) |
| **Step links recall** | **0%** (0/24). The extractor never links (ADR 0012 gap 1). |
| **Step portions** | **0%** (0/4) |
| **Ingredients in the right section** | **43%** (3/7). The lemon-tart filling ingredients are filed under the crust. |
| **Contradictions surfaced** | **0%** (0/1) |
| **Source fields captured** | **0%** (0/7). Tracking parameters are kept, and there is no site name, original title or author. |

**Recorded production outputs** (91 real imports, mostly the AI path):

| Measure | Value |
| --- | --- |
| Steps carrying any ingredient link | 336/871 (39%) |
| Ingredients referenced by any step | 648/1128 (57%) |
| References pointing at no ingredient | **3** (a correctness bug) |
| "Divided" ingredients with no portions | 8 |
| Preparation-like names in ingredient lists | 6 (heuristic) |
| "Optional" only inside the name | 25 |
| Decimal amounts | 23; float artefacts 2 (e.g. `2.3333332538605`) |

**Validator:** 9/9 adjustment candidates are judged as expected. These are
halving, a scaled oven temperature, a missed ingredient, portions over the
total, an invented ingredient, a declared and an undeclared substitution, a
preparation used before it is made, and the Helper rewriting the source.

## 3. Regression scenarios added

| Scenario | Failure classes |
| --- | --- |
| `pumpkin-pudding` | Prepared mixture imported as a purchase, split sugar, servings and macros must stay blank, optional garnish |
| `chocolate-ice-cream` | Hot-milk mixture and custard base as components, cream split across two steps, optional mix-ins, sections |
| `divided-butter-bars` | Butter and flour divided across two sections, crumble preparation, tracking-parameter URL |
| `lemon-tart-sections` | Section confusion (existing fixture, now scored) |
| `flour-contradiction` | List says 1 cup, method says 2 cups |
| `ambiguous-quantities` | Splash, to taste, uncounted eggs, cans |
| `low-confidence-card` | OCR noise, unreadable vanilla quantity, list and method flour disagreement |
| `source-attribution-blog` | Site name, author, original title, URL cleaning |

**Pumpkin pudding and chocolate ice cream are synthetic stand-ins.** The real
recipes and their failure descriptions are not in any repository or session
this work can reach. They are labelled as stand-ins in their `provenance`. When
you supply the real ones, they go in `tests/recipe-model/private/cases/` (git
ignores them) unless you choose to publish them.

## 4. Remaining M1 work

| # | Task | Cost | Acceptance |
| --- | --- | --- | --- |
| 1 | Add the **real** pumpkin pudding and chocolate ice cream cases, and the other failing examples, privately | $0 | Each reproduces its reported failure in the scorer |
| 2 | Annotate truth for **10–15 nightmare URLs** chosen for components, divided ingredients and sections, with page snapshots in the private cache (A in `m1-m3-readiness.md`), committed by hash | $0 | Snapshot hash check, so scoring refuses a changed page |
| 3 | **Response cache and AI-path runner**, behind an explicit `--paid --budget=$N` flag, refusing to run without both. Cache key: case, model, effort, prompt hash. | $0 to build | A dry run prints the estimated cost and makes no calls |
| 4 | Score the AI paths on cached responses for all text and photo cases | Paid (budget) | Per-model, per-effort table: accuracy per metric, latency, real token cost (ADR 0017) |
| 5 | Commit the bake-off report and recommendation | $0 | Numbers recorded; `DEFAULT_AI_MODEL` unchanged until a separate approval |

**M1 exit:**

- every failure class above has at least one case that fails today, with the
  extractor baseline committed;
- the scorer's self-tests pass;
- the bake-off table exists (after budget approval).

## Not done, deliberately

- **Paid model calls:** none were made. The bake-off waits on your budget.
- **Production code:** the extractor and app are untouched. The section and
  link bugs the baseline exposes are fixed in `packages/recipe-core` after M3,
  against this corpus.
- **Superpowers:** the plugin isn't installed in this cloud session. This plan
  follows its write-the-test-first discipline: the scorer's tests came before
  the baseline. A session on your Mac, where the plugin is available, can pick
  it up from here.
