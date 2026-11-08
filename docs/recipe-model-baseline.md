# Recipe-model baseline

Recorded 2026-11-08 on `claude/sweet-wozniak-ye7v06`, against production code
identical to `main` at `7d70c20`. Machine-readable:
[`tests/recipe-model/baseline.json`](../tests/recipe-model/baseline.json).
Reproduce with `node scripts/recipe-model/eval.js`. The command fails on any
difference, and it runs every case twice and checks that both runs are
identical.

**Cost: $0.** No network and no AI calls. **Not measured yet:** the paid AI paths
(6 text cases: pumpkin pudding, chocolate ice cream, ambiguous quantities,
low-confidence card, fraction fidelity, marinade). Their row fills in when the
ADR 0017 bake-off has a budget.

## Free structured import, as a user gets it today

"Extractor + app normalisation" over 11 structured-data cases. These are the
imports RecipeBox makes without AI.

| Measure | Result |
| --- | --- |
| Ingredients found | 68 / 68 (100%) |
| Quantities correct | 62 / 66 (93.9%) |
| Step links: recall | 42 / 71 (59.2%) |
| Step links: precision | 42 / 45 (93.3%) |
| Step portions for divided ingredients | 0 / 6 (0%) |
| Preparations not listed as ingredients | 5 / 6 |
| Ingredients in the right section | 3 / 17 (17.6%) |
| Contradictions surfaced | 0 / 1 |
| Source fields captured (clean URL, site, original title, author) | 0 / 10 |
| Step wording preserved (times, temperatures, pans) | 18 / 18 |

**Detection failures** (the recipe is intact, but the problem isn't shown):

| Failure | Count |
| --- | --- |
| Links missing | 29 |
| Wrong links | 3 |
| Portions missing | 6 |
| Wrong section | 14 |
| Preparation listed as an ingredient | 1 |
| Contradiction not flagged | 1 |
| Source fields missing | 10 |

**Modifications** (the recipe itself was changed):

| Failure | Count |
| --- | --- |
| Ingredients invented | 1 |
| Quantities changed | 2 |
| Quantities dropped | 2 |

The extractor alone has 0% link recall. Every link above comes from the app's
`quantityAwareDirections` pass.

## Live-pipeline bugs this baseline exposes

All are reproducible from public synthetic fixtures. **None is fixed here.**
Production code is unchanged. Fixes belong in `packages/recipe-core` after the
M3 extraction, with these cases as the regression gate.

1. **Unicode fractions after HTML entities are mis-parsed.**
   - `1 &#188; cups packed brown sugar` becomes amount `1`, unit blank, name
     `¼ cups packed brown sugar`.
   - `&#189; cup granulated sugar` loses its amount entirely.
   - `normalizeRecipe` does not repair either. Case: `structured-cookies`. This
     accounts for 2 changed and 2 dropped quantities.
2. **Section headers inside the ingredient list become ingredients.**
   - `For the cake:` and `For the frosting:` are imported as ingredients with no
     amount, and every ingredient lands in one "Main" section.
   - Case: `frosting-headers-in-list`.
3. **The app's chip pass links across sections.**
   - "Beat in the powdered sugar" in the frosting step becomes
     `powdered {i3}`, where `i3` is the *cake's* sugar.
   - A cook would see the cake's 1½ cups of sugar on the frosting step.
4. **HowToSection structure is lost for ingredients.**
   - JSON-LD gives one flat ingredient list.
   - Steps are sectioned, but every ingredient is filed under the first section
     (the lemon tart's filling ingredients sit under "Crust").
5. **Divided ingredients have no portions.**
   - "1 cup butter, divided" shows the full cup on both steps that use half.
6. **Contradictions pass silently.**
   - The ingredient list says 1 cup flour and the method says 2 cups. Both are
     kept, but nothing is flagged.
7. **No attribution beyond the raw URL.**
   - Tracking parameters (`utm_*`, `fbclid`) are kept.
   - Site name, original title and author are not captured, although the page
     states them.

From the **91 recorded production outputs** already in
`tests/results/imports/nightmare-debug` (mostly the AI path):

| Finding | Count |
| --- | --- |
| Steps carrying any link | 336 / 871 (39%) |
| References pointing at no ingredient | **3** |
| "Divided" ingredients with no portions | 8 |
| Decimal amounts | 23 |
| Float artefacts (for example `2.3333332538605`) | 2 |
| "Optional" stored only inside the ingredient name | 25 |

## Validator

13 of 13 adjustment candidates are judged as expected:

- correct halving and doubling;
- a scaled oven temperature;
- a scaled pan size;
- a missed ingredient when scaling;
- portions over the total;
- step wording that disagrees with its portion;
- an invented ingredient;
- a declared and an undeclared substitution;
- a preparation used before it is made;
- a dangling reference;
- the Recipe Helper rewriting the source.

## What changes this baseline

Any intended improvement, such as a fix in `recipe-core`, a new case or a scorer
change, is re-recorded with `--write-baseline`, and the diff of `baseline.json`
is reviewed in the same commit. CI fails on any unrecorded change.
