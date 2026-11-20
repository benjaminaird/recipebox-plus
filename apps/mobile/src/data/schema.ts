// The shape of the local database, as SQL.
//
// Its own module for one reason: it is the only part of the storage layer that
// can be run outside Expo, so a test can create the REAL tables in a real
// SQLite and exercise the code that writes to them — rather than against a
// hand-written copy of the schema, which proves only that the copy is
// self-consistent.
//
// Two rules hold for everything in here, and the tests in
// test/cross-feature.test.ts read this file to enforce them:
//
//   Every CREATE is guarded with IF NOT EXISTS. An upgrade that fails halfway
//   must be safe to run again.
//
//   Nothing drops, renames, deletes or rewrites. A column on a table that
//   already holds rows is added through ADDED_COLUMNS, which becomes an
//   ALTER TABLE ... ADD COLUMN — the one schema change SQLite offers that
//   cannot touch an existing row. Anything else needs a copy-and-swap and a
//   test that the old rows arrived.

/**
 * Bump when the table shape changes; the migration is additive and idempotent.
 *
 * 4 — planned_meals (meal planning).
 * 5 — shopping_lists, shopping_items.
 * 6 — recipe_origin (where a recipe came from; see src/sync/pull.ts).
 * 7 — sync_outbox, sync_conflicts, and the columns sync needs on the two
 *     tables that already existed: recipes.deleted_at, and the server
 *     revision and adoption flag on recipe_origin.
 * 8 — recipe_versions (ADR 0015 on the device).
 */
export const SCHEMA_VERSION = 8;

/** Everything that can be created from nothing, guarded. */
export const SCHEMA_SQL = `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS recipes (
      id          TEXT PRIMARY KEY NOT NULL,
      title       TEXT NOT NULL,
      category    TEXT,
      tags        TEXT NOT NULL DEFAULT '[]',
      search      TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      json        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS recipes_created_at ON recipes (created_at DESC);
    CREATE TABLE IF NOT EXISTS cook_progress (
      recipe_id   TEXT PRIMARY KEY NOT NULL,
      step_index  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    -- Added in schema 2. How the cook chose to VIEW a recipe: the batch scale
    -- and the measurement system. Stored, not derived, because resuming a
    -- cooking session at 1x after someone set 2x would hand them the wrong
    -- quantities for a dish already in the oven.
    -- Added in schema 3. Timers outlive the app: a deadline is absolute, so
    -- a row written before a force-quit is still correct when it is read back,
    -- with no catching up to do.
    CREATE TABLE IF NOT EXISTS timers (
      id           TEXT PRIMARY KEY NOT NULL,
      label        TEXT NOT NULL,
      duration_ms  INTEGER NOT NULL,
      ends_at      INTEGER,
      remaining_ms INTEGER,
      status       TEXT NOT NULL,
      recipe_id    TEXT,
      step_index   INTEGER,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS timers_created_at ON timers (created_at);
    /* Meal planning.
     *
     * The shape is the one ADR 0006 can merge, even though sync is not built:
     * it specifies last-write-wins per day-and-meal slot, so each planned meal
     * carries its own stable id and its own updated_at rather than inheriting a
     * document-level timestamp. Deletes are soft (deleted_at), because that ADR
     * also says a deletion must lose to a concurrent edit -- which is only
     * decidable if the deletion is a row rather than an absence.
     *
     * The date column is TEXT in YYYY-MM-DD form: a calendar day, not an
     * instant. An epoch would move a meal across a timezone change or a
     * daylight-saving boundary; see domain/plan.ts. */
    CREATE TABLE IF NOT EXISTS planned_meals (
      id          TEXT PRIMARY KEY NOT NULL,
      date        TEXT NOT NULL,
      slot        TEXT NOT NULL,
      recipe_id   TEXT NOT NULL,
      scale       REAL NOT NULL DEFAULT 1,
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS planned_meals_date ON planned_meals (date);
    /* Shopping lists.
     *
     * Same sync-ready shape as planned_meals, for the same reason: ADR 0006
     * merges a shopping list as a UNION OF ITEMS, with checked state resolved
     * last-write-wins per item and a deletion that loses to a concurrent edit.
     * All three need per-item identity and per-item timestamps, so items are
     * rows with their own ids and their own updated_at, and nothing is hard
     * deleted.
     *
     * A list keeps its sources as JSON so the generated portion can be rebuilt
     * when a recipe is added. Items record whether they are generated or the
     * cook's own; see ItemOrigin in domain/shoppingList.ts for why editing a
     * generated line adopts it. */
    CREATE TABLE IF NOT EXISTS shopping_lists (
      id          TEXT PRIMARY KEY NOT NULL,
      title       TEXT NOT NULL,
      sources     TEXT NOT NULL DEFAULT '[]',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted_at  INTEGER
    );
    CREATE TABLE IF NOT EXISTS shopping_items (
      id          TEXT PRIMARY KEY NOT NULL,
      list_id     TEXT NOT NULL,
      text        TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'Uncategorized',
      checked     INTEGER NOT NULL DEFAULT 0,
      origin      TEXT NOT NULL DEFAULT 'generated',
      optional    INTEGER NOT NULL DEFAULT 0,
      warning     TEXT,
      sources     TEXT NOT NULL DEFAULT '[]',
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS shopping_items_list ON shopping_items (list_id);
    CREATE TABLE IF NOT EXISTS recipe_view (
      recipe_id   TEXT PRIMARY KEY NOT NULL,
      scale       REAL NOT NULL,
      measurement TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    -- Added in schema 6. Where a recipe came from, kept apart from what the
    -- recipe IS: nothing about sync is written into recipes.json, so losing
    -- this table costs bookkeeping and never a recipe.
    CREATE TABLE IF NOT EXISTS recipe_origin (
      recipe_id         TEXT PRIMARY KEY NOT NULL,
      origin            TEXT NOT NULL,
      account_id        TEXT,
      owner_id          TEXT,
      shared            INTEGER NOT NULL DEFAULT 0,
      server_id         TEXT,
      server_updated_at TEXT,
      pulled_at         TEXT
    );
    CREATE INDEX IF NOT EXISTS recipe_origin_account ON recipe_origin (account_id);
    /* Added in schema 7. What this device owes the server.
     *
     * A table rather than a file or a React state: the queue has to survive
     * the app being killed mid-request, and the only thing on the phone that
     * reliably does is the database the recipe was written to. One row per
     * recipe, which is what makes five offline edits one upload.
     *
     * The row is written in the SAME transaction as the change it describes.
     * A recipe saved without its queue entry is a change the server will never
     * hear about, and the cook has no way of knowing; the transaction is what
     * rules that out rather than hoping the second write also lands.
     *
     * account_id is on the row even though each account already has its own
     * database file. The file boundary is the real guarantee; this is the one
     * that still holds if a future change ever puts two accounts in one file,
     * and it costs a column. */
    CREATE TABLE IF NOT EXISTS sync_outbox (
      recipe_id       TEXT PRIMARY KEY NOT NULL,
      account_id      TEXT NOT NULL,
      kind            TEXT NOT NULL,
      base_revision   INTEGER,
      idempotency_key TEXT NOT NULL,
      recipe_json     TEXT,
      attempts        INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      queued_at       INTEGER NOT NULL,
      last_error      TEXT
    );
    CREATE INDEX IF NOT EXISTS sync_outbox_account ON sync_outbox (account_id);
    /* Added in schema 7. A change the server refused, with both versions.
     *
     * Both bodies are stored whole. ADR 0006 forbids merging and forbids
     * discarding, so the only honest thing to keep is everything, and the only
     * place it can wait is somewhere that survives a restart. Unresolved rows
     * are what the Conflicts screen lists; resolved ones stay as a record of
     * what was chosen and what was given up. */
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id              TEXT PRIMARY KEY NOT NULL,
      recipe_id       TEXT NOT NULL,
      account_id      TEXT NOT NULL,
      mine_json       TEXT,
      theirs_json     TEXT,
      server_revision INTEGER,
      reason          TEXT NOT NULL,
      detected_at     INTEGER NOT NULL,
      resolved_at     INTEGER,
      resolution      TEXT
    );
    CREATE INDEX IF NOT EXISTS sync_conflicts_open ON sync_conflicts (account_id, resolved_at);
    /* Added in schema 8. Recipe history (ADR 0015), on the device.
     *
     * The server has had this since the versioned write API. The phone had
     * none of it, which meant a change made offline — which is most of them,
     * since uploads are off by default — could not be undone at all.
     *
     * Append-only: nothing in the app updates or deletes a row here. Going
     * back to an earlier version APPENDS one holding that content, so undoing
     * never destroys the history it undid.
     *
     * Each row holds the whole recipe. A chain of diffs would be smaller and
     * is the wrong trade, because it is only readable if every link is intact
     * and the one thing this table exists to survive is a half-finished write.
     *
     * The seq column is this device's ordering, 1 upward per recipe, and is
     * not the server's revision: the two count different things, and a local
     * history has to be complete without the network having been reachable.
     *
     * (No backticks in here. The whole of SCHEMA_SQL is one template literal,
     * so a backtick in a comment ends it and the file stops parsing.) */
    CREATE TABLE IF NOT EXISTS recipe_versions (
      id          TEXT PRIMARY KEY NOT NULL,
      recipe_id   TEXT NOT NULL,
      seq         INTEGER NOT NULL,
      cause       TEXT NOT NULL,
      note        TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      json        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS recipe_versions_recipe ON recipe_versions (recipe_id, seq DESC);
  `;

/**
 * Columns on tables that already carry rows.
 *
 * Kept apart from SCHEMA_SQL because they are not created, they are added —
 * to a table that already exists on a phone somewhere, with somebody's
 * recipes in it. Adding one is safe; the migration asks the table what it has
 * before it acts, so running it twice does nothing the second time.
 */
export const ADDED_COLUMNS: ReadonlyArray<{ table: string; column: string; definition: string }> = [
  // Soft deletion. A recipe in the Trash keeps its row and its body: that is
  // what makes "put it back" a column going to NULL rather than a restore
  // from somewhere, and what lets a deletion made with no signal be undone.
  { table: "recipes", column: "deleted_at", definition: "INTEGER" },
  // The server revision this device last agreed with, which is what a write
  // cites so the server can tell a fresh edit from a stale one.
  { table: "recipe_origin", column: "server_revision", definition: "INTEGER" },
  // Whether the cook has put this recipe into their account. Signing in is
  // not a request to upload everything on the phone.
  { table: "recipe_origin", column: "adopted", definition: "INTEGER NOT NULL DEFAULT 0" },
  // What a refused change was trying to do. Added here rather than to the
  // CREATE above, which is the whole reason this list exists: sync_conflicts
  // had already been created on every device that had run the app once, so
  // `CREATE TABLE IF NOT EXISTS` skipped it and the column never appeared.
  // Every write to the table then failed with "no column named kind", and
  // the app reported it, accurately but unhelpfully, as "no connection".
  { table: "sync_conflicts", column: "kind", definition: "TEXT NOT NULL DEFAULT 'write'" },
  // Who shared a recipe, by name. The id alone cannot be shown to anybody:
  // "Copied from someone in your household" is a worse answer than "Copied
  // from Bob's recipe", and attribution is the whole point of recording it.
  { table: "recipe_origin", column: "owner_name", definition: "TEXT" },
];
