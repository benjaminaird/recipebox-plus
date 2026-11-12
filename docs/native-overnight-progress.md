# Native overnight sprint — progress

Durable record for an autonomous multi-milestone session. **If interrupted,
resume from repository state plus this file rather than repeating finished
work.** Each milestone is committed separately; the commit hashes below are the
authoritative record of what actually landed.

Branch: `feature/recipebox-2.0`. No EAS build this session. No production
changes, no merge to main.

---

## Architectural findings that shape the work

Recorded up front because they were the reason for several design choices and
would otherwise have to be rediscovered.

### ADR 0006 dictates the schema, even though sync is not being built

Sync is out of scope for this session, but the storage shapes have to be the
ones a later sync can merge, or stage 2 of ADR 0011 becomes a migration instead
of a feature. ADR 0006 is specific:

- **Meal Plan** merges *last-write-wins per day-and-meal slot*. So a planned
  meal needs its own stable id, an explicit `(date, slot)`, and its own
  `updated_at` — not a document-level timestamp.
- **Shopping List** merges as a *union of items*, with checked state
  last-write-wins per item, and a deletion that **loses to a concurrent edit**.
  So items need stable ids, per-item `updated_at`, and soft deletes.
- **Deletes are soft**, with tombstones outliving the 30-day Trash.

Every table added this session therefore carries: a client-generated stable id,
`created_at`, `updated_at`, and `deleted_at` for a tombstone. Nothing is hard
deleted.

### Dates are calendar days, not instants

A planned meal belongs to a date on a calendar, not a moment in time. Stored as
`YYYY-MM-DD` text. An epoch would move the meal across a timezone change or a
DST boundary — "Tuesday dinner" becoming Monday because the cook flew east is a
bug the storage type can prevent outright.

### Slots are part of the intended model, not an invention

The production web meal plan stores `{ [day]: recipeId[] }` with no slots and no
per-meal servings. ADR 0006 nonetheless specifies merge "per day-and-meal slot",
so slots are the accepted direction and the web storage is simply behind it. The
native model adds `slot` and `scale`. **This is local-only and changes no
production schema**; the contract a future sync would need is documented in
`docs/plan-and-lists-proposal.md`.

### Shopping-list aggregation reuses the production module, unmodified

The real aggregation algorithm is shared, not reimplemented: a list that differs
between phone and laptop is a bug found in a supermarket with a trolley.

During the overnight sprint the native app consumed `public/shopping-list.js`
where it sat, through Metro `watchFolders`, because extracting the package meant
editing production files that session could not touch. **That has since
happened** — see milestone 8 — so the module now lives in
`packages/recipe-core/src/shopping-list.js` and `public/` holds a generated
copy. The native wrappers point at the package; nothing else about the
arrangement changed.

---

## Milestones

| # | Milestone | State | Commit |
| --- | --- | --- | --- |
| 1 | Functional meal planning | **done** | `2b8aad1` |
| 2 | Functional shopping lists | **done** | `2a61255` |
| 3 | Manual recipe create and edit | **done** | `23f95d0` |
| 3b | Safe import-review architecture | **done** | `23f95d0` |
| 4 | Home integration | **done** | `bc5876a` |
| 5 | Cross-feature correctness | **done** | `8ccb50f` |
| 6 | Visual and interaction review | **done** | `318b879` |
| 7 | Documentation and final verification | **done** | `a292410` |
| 8 | Extract `packages/recipe-core` (ADR 0003) | **done** | (this commit) |

## Baseline at session start

`cfa7aef`. 155 mobile tests, tsc clean, all seven domain regression scripts
green, Hermes bundles compile for both platforms, production web files
byte-identical to `main`.

## Milestone 1 — functional meal planning (done)

Working: a week strip for navigation with a dot on any day that has something
planned; the selected day in full, slots in the order they are eaten; add a
recipe to a slot through the shared picker; change a meal's slot, day or batch;
remove it; tap through to the recipe. Empty states say what will happen rather
than reporting a state the cook can already see.

**Verified on the simulator**, not inferred: added a meal, moved it to
tomorrow, set it to 2x, then terminated the app and read the row back; then
shut the simulator down **entirely**, cold booted, and the meal was still
there. The v4 migration left all 7 recipes, the edited tags and the in-progress
cook untouched.

15 new tests, mostly on dates. 170 total.

### Deliberately not implemented (recorded, per the brief)

- **No drag-and-drop reordering** inside a slot. `position` exists in the model
  and is honoured on read, but there is no gesture to change it. Drag would
  compete with the week strip's horizontal scroll and is poor with VoiceOver;
  "Move to" in the options sheet does the same job one-handed.
- **Moving a meal is relative** — a day earlier, a day later, a week later —
  not an arbitrary date picker. Covers the real cases (it slipped, we are away
  that night) without a calendar modal.
- **Measurement preference is not yet reflected** in Plan, because Plan shows
  no quantities. The shopping list is where it becomes visible.

## Milestone 2 — functional shopping lists (done)

Working: name a list; build one from a recipe at the batch on screen, or from
a day or a week of planned meals at each meal's own batch; add more recipes
later; tick and untick; edit a line; add and remove your own items; delete a
list. Aisle ordering and per-item provenance come from the shared module.

**Architectural note — the shared module is loaded, not copied.**
`metro.config.js` adds `../../public` to `watchFolders` and
`src/domain/webShoppingList.ts` is the single typed boundary. A static
`import` (not `require`) is what makes the same file work under both Metro and
`node --test`.

### What the production module could not do

Found by reading its unit tables, and all three are **production web behaviour
this session must not change**:

1. **No metric volumes.** `VOLUME_TO_TSP` runs tsp → gallons and has no ml or
   litre. An unknown unit gets folded into the ingredient NAME, so "200 ml
   double cream" becomes an item called "Ml Double Cream", and "1 L stock" and
   "500 ml stock" never combine.
2. **Metric weights are shown in ounces.** 1.8 kg + 1.2 kg of beef →
   `105.82 oz Beef`.
3. **Vulgar fractions on metric units.** 3.6 kg → `3 5/8 kg`.

The native app works around all three without touching `public/`: metric
volumes are held out and totalled natively, and metric weights are re-rendered
with this app's own formatting rules.

**This is worth raising with you** — the web app presumably shows the same
things to anyone with a metric library. Fixing it properly belongs with the
ADR 0003 extraction, where one corrected copy would serve both surfaces.

### Deliberately not implemented

- **No pantry.** ADR 0011 keeps it in v1 and the brief did not ask for it in
  this milestone. Excluding staples a cook already owns needs a pantry first.
- **Items store a rendered line, not a structured quantity.** An aggregated
  line can be "1 cup + 2 Tbsp sugar"; re-deriving structure would mean parsing
  our own formatting. Editing is therefore editing the text, which is also what
  makes "editing adopts the line" simple to explain.
- **No household sync.** Out of scope by instruction; the storage shape is
  ready for it.

## Open issues, for your decision

1. **Three metric defects in the shopping-list module**, which the web app
   presumably shows too: no metric volume units at all (`ml` and `L` are not
   units to it, so `1 L stock` and `500 ml stock` never combine), metric weights
   displayed in ounces, and vulgar fractions on kilos. Worked around natively;
   **still not fixed at source.** The ADR 0003 extraction is done, so there is
   now one copy to correct and both surfaces would get it — which is exactly why
   this is a decision rather than a chore. Fixing it changes what real web users
   see on a page they use today, and CLAUDE.md holds the web app's behaviour
   fixed until a change is explicitly approved.
2. **The import fetch endpoint.** Contract written, not built. It needs
   decisions on rate limiting, SSRF and response size that are not mine, and
   it is a production change.
3. **A sample recipe was edited during testing.** Weeknight Tarka Dal lost its
   ground turmeric while I was proving that deleting a referenced ingredient
   leaves no dangling step references. It is a legitimate edit and the recipe
   still works; restore it from the editor if you want the sample faithful.
4. **No pantry.** ADR 0011 keeps it in v1. Excluding staples a cook already
   owns needs a pantry first, and the brief did not ask for one here.

## Milestones 3 and 3b — writing, editing, and import review (done)

Writing and editing share one screen. Ingredients split into amount / unit /
name, named parts, and per-step ingredient assignment (ADR 0012). Only a
missing name blocks a save, for the same reason ADR 0014 lets an unresolved
import be saved.

Ingredient ids are **monotonic**. A test caught that they were not: the code
took the highest id currently present, so deleting the last ingredient and
adding another reissued the id just freed. Nothing inside the recipe breaks,
but ADR 0015 keeps every prior version and a restored one would bind to a
different ingredient.

Import review runs the **production** extractor —
`public/recipe-extract.js` and `recipe-grounding.js`, loaded through the same
Metro route as the shopping module. Tests run the real extractor over stored
HTML fixtures. Fetching a page still needs a server endpoint; the contract is
in [native-import-contract.md](./native-import-contract.md) and is **not
built**.

## Milestone 4 — Home integration (done)

Today's planned meals and any unfinished shopping list, each only when it has
something to say. The focal point stays contextual. The "once Plan and Add are
built" footnote is gone, because they are.

## Milestone 5 — cross-feature correctness (done)

Tests for the seams between features, plus two structural guards: the
migration may only ever add (no DROP / ALTER / DELETE / UPDATE, every CREATE
guarded), and every new table carries the stable id, per-row `updated_at` and
tombstone that ADR 0006 will need to merge it.

Verified on the simulator end to end — wrote a recipe by hand, found it by
search, scaled it, shopped it at that batch, and read the result back from
SQLite. The water line came out as **1.8 L**: 1 L from one recipe plus 800 ml
from another at 2x, combined across recipes by code the shared module does not
have.

## Milestone 6 — visual and interaction review (done)

Reviewed in light and dark, at normal and accessibility-extra-large text. One
real defect fixed: the editor's amount field rendered "500" as a single
ellipsis at large text.

## Milestone 7 — final verification (done)

Full gate set green: tokens, sounds, typecheck, 227 mobile tests, Hermes
bundles for both platforms, all seven domain regression scripts. Production web
files byte-identical to `main`.

## Milestone 8 — extract `packages/recipe-core` (done)

ADR 0003's shared package, for real: all eight domain modules moved with
`git mv` so history follows, and the package now holds the only editable copy.

- **`server.js`, the regression scripts and the native app** resolve the modules
  from `packages/recipe-core/src/` by plain relative path. Nothing resolves the
  package name through `node_modules`, and nothing may start to: the CI domain
  job installs nothing at all, which is how the dependency-free contract is
  enforced rather than merely asserted. `build-core.js` also fails on any
  non-relative `require` inside the package, so a bare specifier cannot pass a
  developer's machine and then break CI, the browser and the phone.
- **`public/` holds generated copies.** Vercel serves `public/` as the static
  root and nothing builds on deploy, so the files the browser fetches must
  physically exist there and be committed — the same arrangement `public/app.js`
  has always been in. `npm run build:core` writes them, `npm run core:check`
  fails on drift and runs in CI, and `build:app` now runs `build:core` first so
  one command refreshes everything the browser downloads.
- **Behaviour is unchanged, and measured rather than asserted.** ADR 0003's
  precondition 1 was met with a `main` worktree: the six regression suites that
  exist on both sides produce byte-for-byte identical output before and after.
  Each module body is identical to `main` apart from a banner naming both
  files and which of them to edit — the one thing that stops someone changing
  the generated copy and losing the change on the next build.
- **`apps/web/` was not done** and is not scheduled; ADR 0003 records why.

Verified: `core:check`, all eight domain scripts, the recipe-model scorer and
evaluation, design tokens, all nineteen server scripts, a reproducible
`public/app.js`, mobile tokens / sounds / typecheck / **227 tests**, and Hermes
bundles for both platforms. Strings unique to the package
(`Household / Other`, `heaping`, `itemprop`) are present in the iOS bundle, so
Metro genuinely resolved the moved files rather than silently dropping them.

## Next action

Nothing queued. Open issue 1 is now a single decision with a single place to
act: correcting the metric handling in
`packages/recipe-core/src/shopping-list.js` would fix the phone and the web app
together, and would change what web users see today.
