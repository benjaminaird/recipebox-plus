# Recipe model investigation

A dedicated milestone, required by [ADR 0012](./adr/0012-structured-recipe-model.md),
to resolve how ingredients, steps, components and equipment relate before Recipe
Detail and Cook Mode are finalised. No implementation starts until these
questions are answered and specified.

## Audit result (complete)

| Capability | State today |
| --- | --- |
| Stable ingredient ids | **Exists** (`recipe-schema.js`) |
| Per-step `ingredientRefs` | **Exists** in schema, preserved by normalise |
| Refs populated on AI import paths | Yes |
| Refs populated on deterministic (JSON-LD) path | **No — always empty** (`recipe-extract.js:257, 371`) |
| Refs rendered anywhere in the UI | **No — captured and discarded** |
| Partial quantities / portions per step | **Absent** |
| Component vs ingredient distinction | **Absent** |
| Equipment / tools | **Absent, and actively excluded** (`src/app.jsx:756`) |
| Structured `optional` flag | **Absent** (survives only as text in the name) |
| Quantity agreement between list and steps | **Not checked** |

Each reported symptom maps to a specific gap:

- *"cookie dough" treated as an ingredient* → no component distinction.
- *quantities missing from steps* → refs never rendered.
- *wrong quantity on a step* → no portion concept, so a step can only show the
  ingredient's full amount.
- *ingredients attached to the wrong section* → no section-integrity rule.
- *list and directions contradict each other* → no cross-check between them.
- *imported structure doesn't translate* → the deterministic path produces no
  links at all, so richly-structured sources arrive flat.

## Unresolved questions

These need answers before a specification can be written.

1. **Where do links come from on deterministic imports?** JSON-LD gives no
   step-to-ingredient relationship. Options: a deterministic matcher over step
   text, an AI linking pass over already-trusted content, or leave them unlinked
   and degrade the presentation gracefully. Each trades accuracy against cost
   and against the "no AI on structured sources" principle that keeps those
   imports free.
2. **How are portions expressed?** A fraction of the total, an explicit amount,
   or a label such as "divided"? Explicit amounts are clearer to display but can
   fail to sum to the total.
3. **What happens when portions don't reconcile?** Surface a warning, show the
   full amount, or show the unaccounted remainder — and does this block saving?
4. **How is a component modelled?** As a nested recipe, as an ingredient with a
   `producedBy` link to a step, or as a distinct entity? This decides whether
   components can be scaled and reused independently.
5. **What is the unit of scaling?** Scaling a recipe must scale portions
   consistently and must not scale pan sizes, times or temperatures. Which
   fields are scalable is a model property, not a UI concern.
6. **Does measurement conversion mutate or annotate?** The source's own units are
   authoritative (`weightAmount`/`weightUnit` already captures stated metric
   alternates). Conversion should almost certainly be a display layer, not a
   stored rewrite — needs confirming.
7. **Are substitutions user data or recipe data?** A substitution a cook makes
   once is different from one the source offers.
8. **Does equipment need identity?** Per-step tools may be display-only strings,
   or a referenced entity enabling an equipment list and "recipes for my air
   fryer".
9. **What is the migration path for existing recipes?** Several thousand saved
   recipes have ids but no useful refs. Backfill deterministically, backfill with
   AI, or leave them legacy and render them in the simpler presentation?
10. **What does Cook Mode show when links are missing?** Degrading honestly
    matters more than degrading invisibly.

## How to investigate

1. **Build a corpus of failures first.** The existing 100-case nightmare suite
   measures whether an import *succeeded*, not whether its step links are
   correct. Extend the fixtures with expected ingredient-to-step relationships,
   drawn from the real formatting problems rather than invented cases. This is
   the prerequisite: without it, any new model is unfalsifiable.
2. **Measure the current failure rate** against that corpus, so improvement is
   provable rather than asserted.
3. **Model the hard cases on paper** before writing code — a recipe with
   components (millionaire's shortbread is a good one), an ingredient split
   across steps, an optional garnish, and a source whose list and directions
   genuinely disagree.
4. **Prototype the linking strategies** for question 1 and compare them on the
   corpus.
5. **Specify the model**, then implement against the corpus with the regression
   tests as the gate.

The user will supply further examples of real RecipeBox formatting problems;
those become corpus cases rather than anecdotes.

---

## Partially answered: an ingredient split across steps (2026-11-10)

Hard case 3 above — "an ingredient split across steps" — now has a *rendering*
answer in the native client, though not yet an *extraction* one.

**What exists.** `Step.ingredientUses?: { id, amount?, unit?, note? }[]` in
`apps/mobile/src/data/types.ts`, additive and optional, with
`stepIngredientUses()` resolving each referenced ingredient to the quantity
that is true for that step. Three outcomes:

| basis | when | shown as |
| --- | --- | --- |
| `portion` | the recipe states this step's share | `115 g` |
| `all` | exactly one step uses the ingredient | `280 g` |
| `unspecified` | several steps use it, none says how much | `1 tsp total` |

The third is the point. A ref is evidence of *which* ingredient, never of *how
much*, so an unqualified ref on a shared ingredient is rendered as the recipe
total and labelled as one, instead of being presented as the step's share.
Before this, Recipe Detail and Cook Mode printed the full amount against every
step that referenced an ingredient — for a 230 g butter split across two steps,
that instructed the cook to use 460 g.

The ingredient list keeps the undivided total in all three cases.

Covered by regression tests in `apps/mobile/test/recipes.test.ts`, including
one asserting that the stated shares sum to the amount in the ingredient list,
so a sample that stops adding up fails rather than merely looking odd. The
sample recipe is `brown-butter-chocolate-chip-cookies`, which exercises all
three bases at once.

**Open question: should `public/recipe-schema.js` learn this field?**

Deliberately not changed. `ingredientUses` is currently native-only, which
means nothing populates it except hand-written sample data — the importer
cannot produce it, so no imported recipe benefits.

Adding it to the extraction tool schema is the obvious next step and is held
back on purpose: that schema is the live production web importer's contract,
and the rule is that the production web app stays unchanged in behaviour until
a replacement is approved. Widening the tool definition changes what the model
may emit on every import, for every user, today.

It also should not be decided by assertion. Per the method above, it wants a
corpus: divided-ingredient cases with expected per-step shares, a measurement
of how often extraction gets them right, and the regression scripts as the
gate. Until then the native renderer handles the data correctly when it is
present, and degrades honestly when it is not.
