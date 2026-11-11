# Plan and Lists — proposed next slices

Status: **proposal, nothing built.** This document exists because the native
Plan and Lists tabs are honest placeholders and the next functional milestone
should be chosen deliberately rather than started. It proposes slices against
what already exists, and names the one decision that blocks the largest of them.

Read alongside [product-requirements.md](./product-requirements.md) (which says
only that "Lists contains Shopping List and Pantry", and records Meal Plan's
depth as **unresolved**) and [ADR 0003](./adr/0003-monorepo-with-shared-domain-package.md).

## What already exists, precisely

Not a summary of intentions — what the code does today.

### Shopping list

`public/shopping-list.js` is pure UMD JavaScript with no DOM, no network and no
dependencies. It already does the hard part:

| Export | What it does |
| --- | --- |
| `buildShoppingListFromSections` | Aggregates ingredients across recipes, combining like units |
| `groupShoppingItemsByCategory`, `CATEGORY_ORDER` | Groups into aisle order |
| `parseShoppingIngredient` | Pulls amount / unit / name / prep note out of a line |
| `emptyShoppingList`, `sanitizeShoppingList` | The stored shape, validated on read |
| `sanitizePantry` | The pantry, validated on read |
| `enrichRecipeIngredients`, `groupCompoundIngredients` | Display-only grouping |

The stored shopping list is
`{ title, recipeIds, manualItems, checked, removed, edits }` and the pantry is a
plain `string[]`. `edits`, `checked` and `removed` are keyed overlays on the
computed list, which is what lets the list be recomputed from the recipes
without losing what the cook ticked off.

This is the most valuable code in the repository and the reason the native
client is React Native rather than a rewrite.

### Meal plan

The web meal plan is stored at `recipebox-mealplan-v2` as, simply:

```js
{ [dayKey]: recipeId[] }
```

A day maps to an ordered list of recipe ids. **There is no meal slot** (no
breakfast / lunch / dinner) and **no per-meal servings.** Planning a recipe
twice on one day is two entries with no way to say the second is for six people.

This matters because the native Plan placeholder currently promises "servings
adjusted per planned meal". That is a **model extension**, not existing
behaviour, and it should be recognised as one before it is built. ADR 0012's
scaling work means the display side is ready for it; the storage is not.

## The decision that gates Lists

Lists is the slice with the most existing value behind it and the one I cannot
start without an answer.

`src/domain/` in the native app currently **reimplements** the parts of the
domain logic that Recipe Detail and Cook Mode needed — units, quantities,
conversion, timing. That was the right call for those screens, because they
needed behaviour the web module does not have (density-based conversion,
batch-timing advisories). It was made safe by a parity test
(`apps/mobile/test/units.test.ts`) that `require()`s the real
`public/shopping-list.js` and asserts the two agree on fractions, formatting and
unit abbreviation.

Shopping-list aggregation is different. It is a large, load-bearing, well-tested
algorithm that the native app needs **identically**, because a list that differs
between the phone and the web app is a bug a user will notice at the shop. There
are three ways to get it, and they are not equally good:

**A. Extract `packages/recipe-core` as ADR 0003 specifies.** One copy, consumed
by both surfaces. This is the decided direction and the right end state. It
touches production web files: `src/app.jsx` and `server.js` both load these
modules, and the rule that the production web app stays unchanged in behaviour
means the extraction needs its own isolated, tested change with the regression
suite green on both sides before anything native depends on it. Cost is real;
so is the payoff, and every later slice gets cheaper.

**B. Consume `public/shopping-list.js` from React Native where it sits.** It is
UMD and dependency-free, so a Metro resolver alias could reach it across the
monorepo boundary without moving it. Cheapest to try, and it keeps one copy.
The risk is that it entrenches `public/` as a shared source directory, which is
exactly what ADR 0003 decided against, and Metro's handling of a file outside
the app root is the kind of thing that works until a build server disagrees.

**C. Vendor a copy into the native app.** Fastest, and wrong. Two copies of the
one algorithm users compare across devices will drift, and the drift will be
discovered in a supermarket.

**Recommendation: A, as its own milestone before Lists.** B is defensible as a
spike to prove the module runs unmodified under Hermes — worth an afternoon to
de-risk A — but it should not be where we stop.

## Proposed slices, in dependency order

Each is independently shippable and testable. None requires a schema change to
the production importer.

### 1. Extract `packages/recipe-core` (prerequisite, not a feature)

Move the portable modules behind a package boundary, with `src/app.jsx`,
`server.js` and the native app all importing from it. Success is the seven
domain regression scripts green, the web app's behaviour unchanged, and the
native app able to `import` the real aggregation. No user-visible change at all
— which is the point, and which makes it safe to do first.

### 2. Lists — Shopping List, read and tick

Build the list from recipes the cook chooses, grouped into aisle order by the
real module, with ticking and removal persisted. Overlays (`checked`, `removed`,
`edits`) stay keyed overlays so the list survives a recipe being rescaled.
Offline by construction — it is arithmetic over local data.

Deliberately **not** in this slice: manual items, multiple named lists, sharing.

### 3. Lists — Pantry

A `string[]` of staples, kept out of the generated list. Small, and it makes
slice 2 noticeably better.

### 4. Plan — a week view, at the existing model's fidelity

Seven days, each an ordered list of recipes, matching
`{ [dayKey]: recipeId[] }` exactly so a future sync has nothing to reconcile.
Add and remove; tap through to the recipe. Home's "planned meals" strip becomes
real.

### 5. Plan → Lists

Roll a week's planned recipes into a shopping list. This is slice 2 plus a
selection, and it is where the planner starts earning its place.

### 6. Per-meal servings (model extension — needs a decision first)

Requires extending the stored shape from `recipeId` to
`{ recipeId, servings }` or similar, on both surfaces, with a migration. Worth
doing; worth doing *after* 1–5, and worth an ADR rather than an implementation.

## What this proposal deliberately does not do

- It does not invent meal slots, nutrition targets, pantry-expiry tracking,
  auto-generated plans or store integrations. None of those is in an accepted
  decision, and the brief asked for slices against what we have agreed.
- It does not touch the production importer or the shared recipe schema.
- It does not resolve Meal Plan's depth, which the requirements record as
  unresolved. Slices 4 and 5 are the shallow end on purpose: they match what
  the web app already stores, so choosing to go deeper later costs nothing now.
