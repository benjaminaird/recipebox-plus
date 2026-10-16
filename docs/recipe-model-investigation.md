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
