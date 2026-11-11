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

`public/shopping-list.js` is the real aggregation algorithm and a list that
differs between phone and laptop is a bug found in a supermarket. Extracting
`packages/recipe-core` (ADR 0003) is the right end state but edits
`src/app.jsx` and `server.js` — production files this session must not touch.

So the native app consumes `public/shopping-list.js` **where it sits**, through
Metro `watchFolders`. No production file changes, one copy of the algorithm.
The ADR 0003 extraction remains the proper fix and is still proposed as its own
milestone.

---

## Milestones

| # | Milestone | State | Commit |
| --- | --- | --- | --- |
| 1 | Functional meal planning | **done** | (below) |
| 2 | Functional shopping lists | not started | — |
| 3 | Manual recipe create and edit | not started | — |
| 3b | Safe import-review architecture | not started | — |
| 4 | Home integration | not started | — |
| 5 | Cross-feature correctness | not started | — |
| 6 | Visual and interaction review | not started | — |
| 7 | Documentation and final verification | not started | — |

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

## Open issues

None blocking.

## Next action

Milestone 2, shopping lists: Metro `watchFolders` so the native app can consume
`public/shopping-list.js` unmodified, then the schema, then generation from
recipes and planned meals.
