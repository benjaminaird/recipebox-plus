---
status: proposed — plan only, nothing built
date: 2026-11-12
---

# Connecting an existing RecipeBox collection to the phone

Someone has been using RecipeBox on the web for months. They install the app,
sign in, and expect their recipes. This is the plan for making that happen
without costing them any of it.

Nothing here is built. It implements [ADR 0006](./adr/0006-synchronisation-and-conflict-policy.md)
(revisions, conflicts, tombstones), [ADR 0004](./adr/0004-local-first-with-sqlite.md)
(the phone is authoritative for itself) and [ADR 0011](./adr/0011-native-v1-scope-and-build-order.md)
(sync in four stages), on top of the device authentication that now exists.
**No production migration happens without approval**, and the schema changes
below are additive by construction.

## The one that matters most

A first sync is the single most dangerous operation this product will ever
perform, because it is the only one that can lose a library someone spent years
building. Everything below is arranged around one rule:

> **The first sync after signing in pulls. It does not push.**

The phone arrives holding sample recipes it was seeded with and whatever the
cook has added since. The account arrives holding the real collection. Merging
those automatically is how a sample Lemon Posset ends up in someone's cookbook
forever, and how two phones seeded with the same samples end up fighting over
the same recipe ids. So the first sync downloads, and anything local is offered
separately, as a review the cook can decline.

## What already exists, and what is missing

| Piece | Where | State |
| --- | --- | --- |
| Account, device sessions | `profiles`, `device_sessions` | **done** (ADR 0010/0022) |
| Recipe storage, server | `recipes` (`user_id`, `recipe_json`, `hero_image_url`) | exists, no revision, no tombstone |
| Recipe storage, phone | `apps/mobile/src/data/db.ts` | exists, no sync columns |
| Stable recipe id | `recipe_json->>'id'`, locked per owner in `upsertUserRecipe` | **done** |
| Shared domain logic | `packages/recipe-core` | **done**, and the reason both ends agree |
| Household read overlay | `readVisibleRecipesPage` | **done** |
| Conflict policy | ADR 0006 | decided, not implemented |
| Version history | ADR 0015 | decided, not implemented |

Four things are missing and all four are additive: a revision per record, a
soft delete, a per-account revision counter, and the endpoints.

## Schema

```sql
-- Server. Additive: no column is dropped, no existing value is rewritten.
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS revision     bigint;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS deleted_at   timestamptz;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS deleted_by   text;
CREATE INDEX IF NOT EXISTS recipes_sync_idx ON recipes (user_id, revision);

-- One monotonic counter per account, so a client can ask "everything after N"
-- without a timestamp. Clocks are not evidence (ADR 0006).
CREATE TABLE IF NOT EXISTS account_revisions (
  user_id  text PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0
);
```

Existing rows have `revision IS NULL`. They are backfilled lazily — the first
sync for an account stamps its rows inside the same advisory lock
`upsertUserRecipe` already takes, so the backfill is one transaction per
account and no migration has to sweep the table.

A tombstone is `deleted_at IS NOT NULL` on the row itself rather than a
separate table: the row is already keyed by owner and recipe id, tombstones are
a few bytes, and ADR 0006 asks for them to outlive the 30-day Trash by a long
way. Retention is a policy on `deleted_at`, not a cron job to forget.

On the phone, three columns beside each recipe: `server_revision`,
`dirty` (edited since the last successful push) and `deleted_at`. The migration
is a `CREATE TABLE IF NOT EXISTS`-shaped addition, in the style `db.ts` already
insists on.

## The protocol

```
GET  /api/v1/sync/recipes?since=<revision>&limit=200
     → { recipes: [...], deletions: [{id, revision}], revision, more }

POST /api/v1/sync/recipes
     { writes: [{ recipe, baseRevision }], deletions: [{ id, baseRevision }] }
     → { applied: [{id, revision}], conflicts: [{id, serverRevision, server}] , revision }
```

Pull first, then push. A push cites the revision the client believed it was
editing; a write citing a superseded revision comes back as a conflict rather
than an overwrite, which is ADR 0006's rule stated as a wire format.

**Beyond the tombstone horizon.** A client whose `since` predates the oldest
retained tombstone is told to start again: `{ resyncRequired: true }`. It then
pulls the whole library and replays its own unsynced writes on top. Without
this a long-offline phone silently resurrects deleted recipes, which ADR 0006
names as the specific failure to prevent.

## Conflicts

Recipes are single-owner, so a conflict means the same person edited the same
recipe in two places. Last write wins, and **the loser is kept**: the superseded
version is written into the version history from ADR 0015 and surfaced as "an
older version of this recipe was saved elsewhere". Nothing is merged. An
ingredient list assembled from two versions is a recipe nobody wrote, and
somebody will cook from it.

Household data — Meal Plan, Shopping List, Pantry — merges per element exactly
as ADR 0006 specifies, and is a later stage: the shopping list is where
whole-document last-write-wins does its worst damage, and it deserves its own
milestone rather than a corner of this one.

## The eight things to get right

**Account and household ownership.** Sync pushes only recipes the signed-in
account owns. Household-shared recipes arrive through the existing read overlay
and are read-only on the phone; a member must not be able to push an edit into
someone else's row. The authorization for all of this already exists and is
reused unchanged — no sync endpoint learns a new rule about who may see what.

**Offline edits.** Every local change sets `dirty` and keeps the
`server_revision` it was based on. Reconnecting replays them in order. Nothing
waits for a network to be saved, and nothing is lost by closing the app.

**Conflict resolution.** As above: never silent, never merged, loser kept.

**Deletions and tombstones.** Soft delete, 30-day Trash on the phone,
tombstones retained far longer on the server, and the full-resync rule for a
device that has been away too long.

**Recipe IDs.** The id inside `recipe_json` is already the identity on both
ends, and `upsertUserRecipe` already locks on it per owner. Two hazards:

  - The seeded samples use readable slugs (`lemon-posset`). Two phones seeded
    from the same build hold the *same id for different rows*. They must never
    reach an account — see below — and any recipe that does sync must carry a
    client-generated random id.
  - A local recipe whose id happens to match a server recipe that is not it.
    The adoption step below treats an id collision as two different recipes and
    offers the local one a new id, rather than overwriting.

**Source attribution.** ADR 0020's structured source lives inside
`recipe_json`, so it rides along for free — provided nothing on either side
rewrites the JSON on its way through. The regression test for that is a
round-trip: a recipe with a full source block, pushed and pulled, compares byte
for byte.

**Photos and media.** The blocker worth naming early. Hero images today can be
data URLs inside `recipe_json`, which is why `/api/recipes` carries a 40 MB body
limit. Pushing those through a sync protocol would be slow, expensive and
fragile. So media syncs separately (ADR 0008): recipes carry a reference, an
upload endpoint stores the bytes, and **a missing image never blocks a recipe**
— a cook would rather have the method without the photo than neither. Text
sync ships first; media is its own stage.

**Local samples must not pollute a real account.** `db.ts` already records
exactly which recipes it seeded, in `meta.seeded_ids`. The adoption step
excludes every id in that list, unless the cook has edited it — an edited
sample is theirs now. The samples are also what makes a pull-only first sync
non-negotiable, since a push-first design would put them in everyone's
cookbook.

## Connecting an existing collection, step by step

1. **Sign in.** Nothing syncs yet. The library on the phone is untouched.
2. **Adopt the account.** A full pull into the account's local store. The
   local store is resolved as it is today: the first account to sign in adopts
   the existing library; anyone else gets their own (`localStore.ts`).
3. **Offer what is local.** If the phone holds recipes that are not seeded
   samples, the cook is shown them and asked whether to add them to the
   account. Default: do not. Each one keeps its content and gets a fresh id.
4. **Steady state.** Pull, then push, on launch, on foreground, and after any
   local edit, subject to backoff. All of it behind `requireDeviceAuth`.
5. **Offline.** Reading, cooking, editing and planning all continue. Only sync
   and Connected Imports need a session (ADR 0006).

## How it gets tested

The pattern this milestone established, reused: pure logic over a store
interface, exercised offline in CI, and the same assertions run against a real
PostgreSQL instance in a throwaway container. Specifically —

- A **conflict matrix** as data: local state × server state × expected outcome,
  including "both edited", "deleted here, edited there" and "edited here,
  deleted there". ADR 0006 has an answer for each; the table makes it checkable.
- A **resurrection test**: a device older than the tombstone horizon must be
  told to resync, and must not reintroduce a deleted recipe. Mutating the
  horizon check must fail it.
- A **sample-pollution test**: a phone with seeded samples signs in, and the
  account's row count does not change.
- A **source round-trip** and a **structured-model round-trip** (ADR 0012's
  ingredient ids and step references must survive both directions).
- The **twelve journeys** extended with a thirteenth: sign in on a phone with
  a local library, adopt an account, and lose nothing.

## What needs approval before any of it touches production

- The `ALTER TABLE` statements, even though they are additive.
- The lazy revision backfill, which writes to every row of an account the first
  time it syncs.
- Any change to `/api/recipes`, which the web app uses today.

None of these is in this plan's scope to execute.

---

# Audit: what exists today, and what the first pull needs

Written after reading the server rather than the plan. Three findings decide
the shape of stage one.

## 1. The read path already exists, and is already correct

`readVisibleRecipesPage(userId, { limit, cursor })` (`server.js`) is what
`GET /api/recipes?limit=&cursor=` uses. It is exactly what a pull needs:

- **Keyset pagination** on `(created_at, id) DESC` with an opaque cursor, so a
  page is stable and resumable rather than an offset that shifts under writes.
- **Authorization is in the query**: a row is visible if the caller owns it, or
  if it is `recipe_json->>'shared' = 'true'` *and* the owner shares a household
  with the caller. There is no second rule to get wrong, and the native client
  must not write one.
- Household rows come back annotated `householdShared`, `ownerId`, `ownerName`,
  which is precisely the distinction the phone needs to avoid treating someone
  else's recipe as its own.

**So the pull reuses this function unchanged.** No new authorization path, no
second notion of who may see what.

## 2. What it does not return, and therefore what is missing

The function returns the canonicalised `recipe_json` and nothing about the row.
The payload carries no `recipes.id`, no `updated_at`, no revision. For a pull
that is survivable — the recipe's own `id` is the identity — but the phone
cannot record *when* it saw a version, and a later delta sync has no watermark.

The gap, precisely:

| Needed | Exists? |
| --- | --- |
| A versioned endpoint under `/api/v1` | **no** — the web route is unversioned and cookie-authenticated |
| Per-recipe `updatedAt` in the payload | **no** — the column exists, it is not returned |
| The server row id, for provenance | **no** — same |
| A `since` watermark for deltas | **no** — the cursor is a snapshot position, not a watermark |
| Tombstones | **no** — deletes are hard today |

Stage one needs the first three. The last two belong to the delta and upload
stages and are designed above.

**The endpoint therefore returns an envelope, not a bare recipe:**

```
GET /api/v1/recipes?limit=100&cursor=<opaque>
→ { recipes: [ { recipe, serverId, ownerId, shared, updatedAt } ],
    nextCursor, syncedAt }
```

and the envelope is produced by the *same* `readVisibleRecipesPage` call, with
an option that changes the presentation and not the query. One authorization
rule, one recipe model, two shapes — the web's response stays byte-identical.

## 3. Three kinds of recipe have to stay apart on the device

The phone will hold recipes from three places, and conflating any two of them
loses data or leaks it:

| Origin | Where it came from | May it be uploaded? |
| --- | --- | --- |
| `sample` | Seeded by `db.ts` on first launch | **never** |
| `local` | Made on the phone, signed out or not yet reconciled | only by explicit choice, later |
| `cloud` | Pulled from an account | it is already there |

`db.ts` already records exactly which recipes it seeded, in `meta.seeded_ids`,
so samples are identifiable today without guessing. That list is the reason a
first sync must pull and not push: every install seeds the *same ids*, so two
phones pushing samples would collide on `lemon-posset` as though it were one
recipe being edited in two places.

**Provenance is stored apart from content**, in its own table keyed by the
recipe's product id:

```sql
CREATE TABLE IF NOT EXISTS recipe_origin (
  recipe_id         TEXT PRIMARY KEY,   -- matches recipes.id, the product id
  origin            TEXT NOT NULL,      -- 'sample' | 'local' | 'cloud'
  account_id        TEXT,               -- the account that pulled it
  owner_id          TEXT,               -- the cloud owner; differs when shared
  shared            INTEGER NOT NULL DEFAULT 0,
  server_updated_at TEXT,
  pulled_at         TEXT
);
```

Nothing about sync is written into `recipes.json`, so a recipe's content is
still only what the recipe is. Dropping the table loses bookkeeping, never a
recipe.

**Account switching is already handled and needs nothing new here.**
`localStore.ts` gives a second account its own SQLite file, so one account's
library cannot appear under another; provenance lives inside each store and
inherits that isolation.
