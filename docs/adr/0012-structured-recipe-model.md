---
status: accepted
date: 2026-10-16
---

# A structured recipe model: one ingredient list, steps that reference it

The recurring ingredient/instruction inconsistencies in RecipeBox are a data-model
problem, not a prompting problem. RecipeBox 2.0 adopts a model where **the
ingredient list is the single source of truth** and a step never stores its own
copy of a quantity. A step points at ingredients; the presentation layer resolves
those pointers at render time. A step therefore *cannot* contradict the list,
because it holds no independent quantity to drift.

## Why not copy Babish's data shape

Babish's per-step ingredient display is the UX target and worth matching. Its
underlying approach is not: the step entries are duplicated text, and on
`millionaires-shortbread` they have already drifted from the ingredient list in
three places — the Shortbread Only list says `1 cup all purpose flour` while its
step 1 says `2 cup all purpose flour`; a caramel step says
`1 sweetened condensed milk` where the list says `14 oz`; and a butter entry
loses `melted`. Denormalised quantities drift. That is exactly the failure we are
trying to eliminate, so we take the presentation and reject the storage.

## What already exists

`public/recipe-schema.js` already defines stable ingredient ids (`i1`, `i2`) and
a per-step `ingredientRefs` array. `recipe-normalize.js` preserves them
(lines 566, 583). The foundation is in place, which makes this an extension
rather than a rewrite.

Two gaps explain the symptoms:

1. **The deterministic path never links anything.** The JSON-LD extractor assigns
   ids but emits `ingredientRefs: []` unconditionally
   (`recipe-extract.js:257, 371-372`), because schema.org/Recipe has no
   step-to-ingredient relationship to read. Our *highest-quality* import path
   produces the *least* structured data.
2. **Nothing renders the refs.** They are written by the AI path, carried through
   normalisation, initialised on manual step creation — and never read to display
   anything. The links are collected and discarded.

## What the model must add

- **Portions.** A reference carries the share of the ingredient used at that step,
  so "half the butter now, half later" is expressible. Without this a step can
  only show the full listed amount, which is the direct cause of "wrong quantity
  on a step". Portions across all references to an ingredient must be reconcilable
  against its total, and a mismatch is surfaced, never silently corrected.
- **Component vs ingredient.** An intermediate preparation such as "cookie dough"
  or "caramel" is a *component* — something the recipe produces and later
  consumes — not an ingredient to buy. The model must distinguish them so a
  component stops appearing in ingredient lists and shopping lists. Nothing in
  the current schema expresses this.
- **Equipment.** Tools are currently *excluded by instruction* — prompts say
  "Never include equipment, tools, bowls, pans ... as ingredients"
  (`src/app.jsx:756`) — so per-step tools cannot be shown at all. Equipment
  becomes a first-class entity, referenced by steps like ingredients.
- **Optional flags.** "Optional" currently survives only as words inside an
  ingredient name. It becomes a structured flag so it can be honoured in
  scaling, shopping lists and presentation.
- **Section integrity.** An ingredient belongs to exactly one section, and a
  step may only reference ingredients reachable from its own section or the
  recipe's shared list.

## Non-negotiables

- AI may not invent an ingredient, a reference or a quantity.
- Contradictions between a source's list and its steps are **preserved and
  surfaced for the user to resolve**, never silently reconciled. The existing
  grounding module already treats its findings as advisory rather than as
  licence to edit (`recipe-grounding.js`); that principle extends to quantities.
- Original source text is retained for every ingredient (`raw` already does
  this) so any normalisation remains auditable.

## Scope of the consequences

One resolved model must drive **Recipe Detail, Cook Mode, Shopping Lists and PDF
export**. Cook Mode in particular must not keep its own interpretation of the
recipe. Serving scaling and measurement conversion become functions over the
single model rather than per-surface string manipulation.

This work gets its own discovery, specification and regression milestone, and it
lands **before** Recipe Detail and Cook Mode are finalised. See
[the investigation plan](../recipe-model-investigation.md).
