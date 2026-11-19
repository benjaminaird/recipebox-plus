// The device's sync tables, exercised against a real SQLite.
//
// Everything else about synchronisation is tested without a database, because
// everything else about it is a decision rather than a write. This file is the
// other half: it creates the REAL schema — src/data/schema.ts, the same string
// the phone runs — in node's own SQLite, and drives the real store against it.
//
// That matters more than it sounds. A store tested against a hand-written fake
// proves the fake works. The defects that actually cost data here are SQL ones:
// a NOT NULL that fires on an upgrade, an ON CONFLICT that updates the wrong
// row, a DELETE whose subquery is subtly wrong. None of them are visible
// without a database that enforces the constraints.
//
// Expo's SQLite cannot run under node. node:sqlite is the same engine with a
// synchronous interface, so the adapter below is the whole of the difference.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ADDED_COLUMNS, SCHEMA_SQL } from "../src/data/schema.ts";
import {
  adoptRecipe, applyResolution, countOpenConflicts, countQueued, fullResync, heldRecipes,
  listOpenConflicts, putSharedRecipe, queueLocalChange, revokeSharedRecipes, saveMyOwnCopy,
  sqliteSyncStore, unadoptedRecipes, type SqliteLike,
} from "../src/data/sqliteSyncStore.ts";
import { planHouseholdRead } from "../src/sync/household.ts";
import { resolve } from "../src/sync/outbox.ts";
import { runSync } from "../src/sync/coordinator.ts";
import type { Recipe } from "../src/data/types.ts";

// ---------------------------------------------------------------------------
// The adapter, and the real schema
// ---------------------------------------------------------------------------

function adapt(db: DatabaseSync): SqliteLike {
  let depth = 0;
  return {
    async getFirstAsync<T>(sql: string, args: unknown[] = []) {
      return (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, args: unknown[] = []) {
      return db.prepare(sql).all(...(args as never[])) as T[];
    },
    async runAsync(sql: string, args: unknown[] = []) {
      return db.prepare(sql).run(...(args as never[]));
    },
    async withTransactionAsync(body: () => Promise<void>) {
      // Depth-counted, because expo-sqlite's own transactions nest and this
      // has to behave the same way: a store method that opens one may be
      // called from inside a caller that already has.
      if (depth++ === 0) db.exec("BEGIN");
      try {
        await body();
        if (--depth === 0) db.exec("COMMIT");
      } catch (err) {
        if (--depth === 0) db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

/** The migration, exactly as db.ts performs it. Idempotent, and run twice here. */
function migrate(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * node:sqlite hands back null-prototype rows, and deepStrictEqual compares
 * prototypes. Plain objects, so an assertion fails over a value rather than
 * over how the driver happened to allocate it.
 */
function plain<T extends object>(row: T): T {
  return { ...row };
}

function fresh(): { raw: DatabaseSync; db: SqliteLike } {
  const raw = new DatabaseSync(":memory:");
  migrate(raw);
  return { raw, db: adapt(raw) };
}

const ALICE = "alice";
const LIBRARY = "recipebox-alice.db";
const here = () => LIBRARY;

function recipe(id: string, title = "Soda bread", overrides: Partial<Recipe> = {}): Recipe {
  return {
    id, title, createdAt: 1_000, updatedAt: 2_000,
    sections: [{
      name: "",
      ingredients: [{ id: "i1", name: "plain flour", amount: "250", unit: "g" }],
      steps: [{ id: "s1", text: "Mix." }],
    }],
    ...overrides,
  } as Recipe;
}

/** Put a recipe on the device, the way db.ts's upsert does. */
function put(raw: DatabaseSync, r: Recipe, deletedAt: number | null = null): void {
  raw.prepare(
    `INSERT INTO recipes (id, title, category, tags, search, created_at, updated_at, json, deleted_at)
     VALUES (?, ?, NULL, '[]', ?, ?, ?, ?, ?)`,
  ).run(r.id, r.title, r.title.toLowerCase(), r.createdAt, r.updatedAt, JSON.stringify(r), deletedAt);
}

function origin(
  raw: DatabaseSync, recipeId: string,
  kind: "local" | "cloud" | "sample", adopted = 0, revision: number | null = null,
): void {
  raw.prepare(
    `INSERT INTO recipe_origin (recipe_id, origin, account_id, shared, adopted, server_revision)
     VALUES (?, ?, ?, 0, ?, ?)`,
  ).run(recipeId, kind, ALICE, adopted, revision);
}

const write = (recipeId: string, r: Recipe | null, created = false) =>
  ({ recipeId, kind: "write" as const, recipe: r, created });
const remove = (recipeId: string) =>
  ({ recipeId, kind: "delete" as const, recipe: null, created: false });

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

test("a queued change survives the migration running again", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("r1"));
  origin(raw, "r1", "cloud", 1, 7);
  await queueLocalChange(db, ALICE, write("r1", recipe("r1", "Changed")));
  assert.equal(await countQueued(db, ALICE), 1);

  // An upgrade is not a reason to forget a promise. A recipe whose change
  // vanished here would look perfectly fine on the phone and simply never
  // arrive in the account — the worst shape a data-loss bug can take, because
  // nothing about it looks wrong.
  migrate(raw);
  migrate(raw);

  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  const queue = await store.listOutbox();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].recipe?.title, "Changed");
  assert.equal(queue[0].baseRevision, 7);
});

test("five edits offline are one upload, against the revision the server agreed with", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("r1"));
  origin(raw, "r1", "cloud", 1, 4);

  for (let i = 1; i <= 5; i += 1) {
    await queueLocalChange(db, ALICE, write("r1", recipe("r1", "Edit " + i)), 1_000 + i);
  }

  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  const queue = await store.listOutbox();
  assert.equal(queue.length, 1, "one recipe is owed once, not five times");
  assert.equal(queue[0].recipe?.title, "Edit 5", "the latest body is what goes");
  // The base revision is the one the server last agreed with, not a later one
  // this device never pulled.
  assert.equal(queue[0].baseRevision, 4);
  assert.equal(queue[0].queuedAt, 1_001, "it has been owed since the first edit");
});

test("a sample is never queued, however it is changed", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("sample-1"));
  origin(raw, "sample-1", "sample");

  await queueLocalChange(db, ALICE, write("sample-1", recipe("sample-1", "Mine now")));
  await queueLocalChange(db, ALICE, remove("sample-1"));
  await queueLocalChange(db, ALICE, write("sample-1", recipe("sample-1", "Again"), true));

  assert.equal(await countQueued(db, ALICE), 0);
  // And adopting one is refused too: every install ships the same ids.
  assert.equal(await adoptRecipe(db, ALICE, "sample-1"), false);
  assert.equal(await countQueued(db, ALICE), 0);
});

test("a recipe that predates the account is not uploaded by being edited", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("old"));
  origin(raw, "old", "local", 0);

  await queueLocalChange(db, ALICE, write("old", recipe("old", "Tweaked")));
  assert.equal(await countQueued(db, ALICE), 0, "fixing a typo is not a request to publish");

  assert.deepEqual((await unadoptedRecipes(db, ALICE)).map((r) => r.id), ["old"]);

  assert.equal(await adoptRecipe(db, ALICE, "old"), true);
  assert.equal(await countQueued(db, ALICE), 1, "asked for, and only then");
  assert.deepEqual(await unadoptedRecipes(db, ALICE), []);

  // And from then on an edit does queue, because it is now the account's.
  await queueLocalChange(db, ALICE, write("old", recipe("old", "Tweaked again")));
  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  assert.equal((await store.listOutbox())[0].recipe?.title, "Tweaked again");
});

test("a recipe written while signed in belongs to the account", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("new"));
  await queueLocalChange(db, ALICE, write("new", recipe("new"), true));

  assert.equal(await countQueued(db, ALICE), 1);
  const row = raw.prepare(`SELECT origin, account_id, adopted FROM recipe_origin WHERE recipe_id = 'new'`)
    .get() as { origin: string; account_id: string; adopted: number };
  assert.deepEqual(plain(row), { origin: "local", account_id: ALICE, adopted: 1 });
  assert.deepEqual(await unadoptedRecipes(db, ALICE), [], "it is not waiting to be reconciled");
});

test("a delete swallows a pending write, and an unsent create simply vanishes", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("known"));
  origin(raw, "known", "cloud", 1, 3);
  put(raw, recipe("brand-new"));

  await queueLocalChange(db, ALICE, write("known", recipe("known", "Edited")));
  await queueLocalChange(db, ALICE, remove("known"));
  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  const afterKnown = await store.listOutbox();
  assert.equal(afterKnown.length, 1);
  assert.equal(afterKnown[0].kind, "delete", "sending the write first would resurrect it, then delete it");
  assert.equal(afterKnown[0].baseRevision, 3);

  await queueLocalChange(db, ALICE, write("brand-new", recipe("brand-new"), true));
  await queueLocalChange(db, ALICE, remove("brand-new"));
  assert.equal(
    (await store.listOutbox()).filter((e) => e.recipeId === "brand-new").length, 0,
    "the server never heard of it, so there is nothing to tell it",
  );
});

test("the queue belongs to one account, and so does every write", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("r1"));
  origin(raw, "r1", "cloud", 1, 1);
  await queueLocalChange(db, ALICE, write("r1", recipe("r1", "Alice's")));

  const bobsView = sqliteSyncStore(db, "bob", LIBRARY, here);
  assert.deepEqual(await bobsView.listOutbox(), [], "Bob cannot see what Alice owes");

  // And a store pointed at a library that is not the one open refuses to
  // write at all, rather than writing into somebody else's recipes.
  const elsewhere = sqliteSyncStore(db, ALICE, "recipebox-someone-else.db", here);
  await assert.rejects(() => elsewhere.setWatermark(5), /different library/);
  await assert.rejects(() => elsewhere.removeFromOutbox("r1"), /different library/);
  await assert.rejects(
    () => elsewhere.putRemote({
      envelope: {
        recipe: recipe("r2"), serverId: "s2", ownerId: ALICE, ownerName: null,
        shared: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      },
      revision: 2,
    }),
    /different library/,
  );
});

test("a failed send updates the entry, and never resurrects one the server answered", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("r1"));
  origin(raw, "r1", "cloud", 1, 1);
  await queueLocalChange(db, ALICE, write("r1", recipe("r1")));

  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  const [entry] = await store.listOutbox();
  await store.updateOutboxEntry({ ...entry, attempts: 3, lastError: "offline", nextAttemptAt: 9_999 });
  const [updated] = await store.listOutbox();
  assert.equal(updated.attempts, 3);
  assert.equal(updated.lastError, "offline");
  assert.equal(updated.recipe?.id, "r1", "the change itself is untouched");

  await store.removeFromOutbox("r1");
  await store.updateOutboxEntry({ ...entry, attempts: 4 });
  assert.deepEqual(await store.listOutbox(), [], "an answered change does not come back");
});

// ---------------------------------------------------------------------------
// What the server says
// ---------------------------------------------------------------------------

test("a recipe pulled down carries its revision, and a restore undeletes it", async () => {
  const { raw, db } = fresh();
  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  const envelope = {
    recipe: recipe("r1"), serverId: "s1", ownerId: ALICE, ownerName: null, shared: false,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
  };

  await store.putRemote({ envelope, revision: 11 });
  assert.deepEqual(await store.getLocal("r1"), {
    recipeId: "r1", origin: "cloud", adopted: true, serverRevision: 11,
    deletedLocally: false, shared: false,
  });

  await store.applyRemoteDeletion("r1", 12);
  const deleted = await store.getLocal("r1");
  assert.equal(deleted?.deletedLocally, true, "soft: the body is still here to be put back");
  assert.equal(
    (raw.prepare(`SELECT COUNT(*) AS n FROM recipes WHERE id = 'r1'`).get() as { n: number }).n, 1,
  );

  // A restore in the account comes down as an ordinary change, and has to
  // bring the recipe back rather than leaving a deleted row with new content.
  await store.putRemote({ envelope: { ...envelope, recipe: recipe("r1", "Restored") }, revision: 13 });
  const back = await store.getLocal("r1");
  assert.equal(back?.deletedLocally, false);
  assert.equal(back?.serverRevision, 13);
});

test("a full resync keeps what this device has not sent yet", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("pulled"));
  origin(raw, "pulled", "cloud", 1, 2);
  put(raw, recipe("edited"));
  origin(raw, "edited", "cloud", 1, 3);
  put(raw, recipe("mine"));
  origin(raw, "mine", "local", 1);

  await queueLocalChange(db, ALICE, write("edited", recipe("edited", "Not sent yet")));

  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  await store.clearCloudRecipes();

  const ids = (raw.prepare(`SELECT id FROM recipes ORDER BY id`).all() as Array<{ id: string }>)
    .map((r) => r.id);
  // "pulled" goes, and the pull puts it back. "edited" stays, because its
  // change has not been sent and discarding it would turn a bookkeeping
  // problem into lost work. "mine" was never the server's to forget.
  assert.deepEqual(ids, ["edited", "mine"]);
  assert.equal((await store.listOutbox()).length, 1);
});

test("what the server accepted is what the next edit cites", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("r1"));
  await queueLocalChange(db, ALICE, write("r1", recipe("r1"), true));

  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  await store.markSynced("r1", 42, false);
  await store.removeFromOutbox("r1");

  await queueLocalChange(db, ALICE, write("r1", recipe("r1", "Next")));
  assert.equal((await store.listOutbox())[0].baseRevision, 42);

  // A delete the server applied leaves the recipe out of the library.
  await store.markSynced("r1", 43, true);
  assert.equal((await store.getLocal("r1"))?.deletedLocally, true);
});

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

async function conflicted(): Promise<{ raw: DatabaseSync; db: SqliteLike }> {
  const { raw, db } = fresh();
  put(raw, recipe("r1", "Mine"));
  origin(raw, "r1", "cloud", 1, 5);
  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  await store.recordConflict({
    recipeId: "r1",
    kind: "write",
    mine: recipe("r1", "Mine"),
    theirs: recipe("r1", "Theirs"),
    serverRevision: 9,
    reason: "revision_mismatch",
    detectedAt: 5_000,
    resolvedAt: null,
  });
  return { raw, db };
}

test("a refused change is kept whole, on both sides", async () => {
  const { db } = await conflicted();
  const [open] = await listOpenConflicts(db, ALICE);
  assert.equal(open.mine?.title, "Mine");
  assert.equal(open.theirs?.title, "Theirs");
  assert.equal(open.serverRevision, 9);
  assert.equal(await countOpenConflicts(db, ALICE), 1);
  assert.equal(await countOpenConflicts(db, "bob"), 0, "and it is Alice's to settle");
});

test("keeping the account's version queues nothing and loses nothing", async () => {
  const { db } = await conflicted();
  const [open] = await listOpenConflicts(db, ALICE);

  await applyResolution(db, ALICE, open, resolve(open, "keep-theirs", 6_000), 6_000);

  assert.equal(await countOpenConflicts(db, ALICE), 0);
  assert.equal(await countQueued(db, ALICE), 0);
  // The version not chosen is still written down. Nothing here destroys a
  // recipe because somebody answered a question.
  const row = (db as unknown as { getFirstAsync: typeof db.getFirstAsync });
  const saved = await row.getFirstAsync<{ mine_json: string; resolution: string }>(
    `SELECT mine_json, resolution FROM sync_conflicts WHERE recipe_id = 'r1'`,
  );
  assert.equal(saved?.resolution, "keep-theirs");
  assert.equal((JSON.parse(saved!.mine_json) as Recipe).title, "Mine");
});

test("keeping my version sends it again, against the revision that beat it", async () => {
  const { db } = await conflicted();
  const [open] = await listOpenConflicts(db, ALICE);

  await applyResolution(db, ALICE, open, resolve(open, "keep-mine", 6_000), 6_000);

  assert.equal(await countOpenConflicts(db, ALICE), 0);
  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  const [queued] = await store.listOutbox();
  assert.equal(queued.recipe?.title, "Mine");
  assert.equal(queued.baseRevision, 9, "an edit made with current information, not a forced overwrite");
  assert.equal(queued.attempts, 0);
});

test("keeping both makes a second recipe, and leaves the account's alone", async () => {
  const { raw, db } = await conflicted();
  const [open] = await listOpenConflicts(db, ALICE);

  await applyResolution(db, ALICE, open, resolve(open, "keep-both", 6_000, "r1-copy"), 6_000);

  const titles = (raw.prepare(`SELECT id, title FROM recipes ORDER BY id`).all() as Array<{ id: string; title: string }>)
    .map(plain);
  assert.deepEqual(titles, [
    { id: "r1", title: "Mine" },
    { id: "r1-copy", title: "Mine (my version)" },
  ]);
  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  const [queued] = await store.listOutbox();
  assert.equal(queued.recipeId, "r1-copy");
  assert.equal(queued.baseRevision, null, "a new recipe is created, not written over anything");
  assert.equal(await countOpenConflicts(db, ALICE), 0);
});

test("resolving the same conflict twice does not make two copies", async () => {
  const { raw, db } = await conflicted();
  const [open] = await listOpenConflicts(db, ALICE);

  // The same moment, so the same id: a double tap, or a retry after the screen
  // came back, must not leave the cook with two of the same recipe.
  await applyResolution(db, ALICE, open, resolve(open, "keep-both", 6_000, "r1-copy"), 6_000);
  await applyResolution(db, ALICE, open, resolve(open, "keep-both", 6_000, "r1-copy"), 6_000);

  const n = (raw.prepare(`SELECT COUNT(*) AS n FROM recipes WHERE id = 'r1-copy'`).get() as { n: number }).n;
  assert.equal(n, 1);
});

// ---------------------------------------------------------------------------
// And the real coordinator, against the real store
// ---------------------------------------------------------------------------

test("the coordinator runs against this store, pulls, pushes and conflicts", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("local-1"));
  origin(raw, "local-1", "cloud", 1, 1);
  await queueLocalChange(db, ALICE, write("local-1", recipe("local-1", "Changed here")));

  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  const pushed: unknown[] = [];

  const report = await runSync(store, {
    async pull(since) {
      if (since > 0) return { recipes: [], deletions: [], revision: 20, more: false, resyncRequired: false };
      return {
        recipes: [{
          recipe: recipe("remote-1", "From the account"), serverId: "s9", revision: 20,
          createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
        }],
        deletions: [],
        revision: 20, more: false, resyncRequired: false,
      };
    },
    async push(body) {
      pushed.push(body);
      return {
        applied: [],
        conflicts: [{
          recipeId: "local-1", status: "conflict" as const, reason: "revision_mismatch",
          serverRevision: 21, server: recipe("local-1", "Changed there"),
        }],
        rejected: [], skipped: [], revision: 21,
      };
    },
  }, { uploads: true, now: () => 7_000 });

  assert.equal(report.pulled, 1);
  assert.equal(report.conflicts, 1);
  assert.equal(report.stillQueued, 0, "the server answered, so it is no longer owed");

  // The pulled recipe is really on the device, with its revision.
  assert.equal((await store.getLocal("remote-1"))?.serverRevision, 20);
  assert.equal(await store.getWatermark(), 20);

  // And the refused change is waiting for a person, with both versions.
  const [open] = await listOpenConflicts(db, ALICE);
  assert.equal(open.mine?.title, "Changed here");
  assert.equal(open.theirs?.title, "Changed there");
  assert.equal(open.serverRevision, 21);
});

// ---------------------------------------------------------------------------
// The library guard
// ---------------------------------------------------------------------------

test("a write into a library that is not this account's is refused, not misdirected", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("r1"));
  origin(raw, "r1", "cloud", 1, 1);

  // Opening a library is asynchronous, so a sign-in can land between a save
  // starting and its row being written. The name that was expected and the
  // name actually open are compared AT the write, which is the only moment
  // worth asserting about.
  const elsewhere = { expected: "recipebox-someone-else.db", active: here };

  await assert.rejects(
    () => queueLocalChange(db, ALICE, write("r1", recipe("r1", "Changed")), 1_000, elsewhere),
    /different library/,
  );
  assert.equal(await countQueued(db, ALICE), 0, "and nothing was written on the way out");

  await assert.rejects(() => adoptRecipe(db, ALICE, "r1", 1_000, elsewhere), /different library/);

  // An unresolved library is refused too. "We do not know yet" is not a
  // reason to write somewhere and find out.
  await assert.rejects(
    () => queueLocalChange(db, ALICE, write("r1", recipe("r1")), 1_000, { expected: "", active: here }),
    /no library resolved/,
  );

  // And the guard is permissive only when there is none to apply, which is
  // what the store's own methods have always done.
  await queueLocalChange(db, ALICE, write("r1", recipe("r1", "Changed")), 1_000, { expected: LIBRARY, active: here });
  assert.equal(await countQueued(db, ALICE), 1);
});

test("one account's queued change is never taken over by another's", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("r1"));
  origin(raw, "r1", "cloud", 1, 1);
  await queueLocalChange(db, ALICE, write("r1", recipe("r1", "Alice's unsent edit")));

  // Updating is already account-scoped, so Bob's attempt finds nothing and
  // does nothing. Harmless, and worth pinning down.
  const bobsStore = sqliteSyncStore(db, "bob", LIBRARY, here);
  await bobsStore.updateOutboxEntry({
    recipeId: "r1", kind: "write", baseRevision: 1, idempotencyKey: "k",
    recipe: recipe("r1", "Bob's"), attempts: 9, nextAttemptAt: 0, queuedAt: 1, lastError: "bob",
  });
  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  assert.equal((await store.listOutbox())[0].recipe?.title, "Alice's unsent edit");
  assert.equal((await store.listOutbox())[0].attempts, 0);

  // Queuing is the path that could take the row over: both tables are keyed
  // by the recipe id alone, so an upsert would quietly rewrite account_id and
  // Alice's promise to send her edit would disappear with nothing to show it
  // ever existed.
  //
  // Two guards now stand in the way, and the provenance one happens to fire
  // first — so this asserts the property rather than which guard produced it.
  // The one in writeEntry is still worth keeping: it is the last thing before
  // the row is written, and it does not depend on recipe_origin having been
  // got right.
  await assert.rejects(
    () => queueLocalChange(db, "bob", write("r1", recipe("r1", "Bob's own"), true)),
    /another account's/,
  );
  assert.equal((await store.listOutbox())[0].recipe?.title, "Alice's unsent edit");
});

test("a resync clears this account's cloud recipes and nobody else's", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("alice-cloud"));
  origin(raw, "alice-cloud", "cloud", 1, 2);
  put(raw, recipe("bob-cloud"));
  raw.prepare(
    `INSERT INTO recipe_origin (recipe_id, origin, account_id, shared, adopted, server_revision)
     VALUES ('bob-cloud', 'cloud', 'bob', 0, 1, 2)`,
  ).run();

  await sqliteSyncStore(db, ALICE, LIBRARY, here).clearCloudRecipes();

  const ids = (raw.prepare(`SELECT id FROM recipes ORDER BY id`).all() as Array<{ id: string }>)
    .map((r) => r.id);
  assert.deepEqual(ids, ["bob-cloud"], "Alice's rebuild is not Bob's data loss");
});

test("a recipe another account adopted is not this account's to upload", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("shared-id"));
  raw.prepare(
    `INSERT INTO recipe_origin (recipe_id, origin, account_id, shared, adopted, server_revision)
     VALUES ('shared-id', 'local', 'bob', 0, 1, 4)`,
  ).run();

  // Alice sees a recipe with no provenance of her own. Reading Bob's row
  // would make it look adopted, and would cite a revision from an account she
  // cannot see — a write against a revision that means nothing to her.
  assert.deepEqual((await unadoptedRecipes(db, ALICE)).map((r) => r.id), ["shared-id"]);
  await queueLocalChange(db, ALICE, write("shared-id", recipe("shared-id", "Alice edits it")));
  assert.equal(await countQueued(db, ALICE), 0, "editing it is not adopting it");
});

test("a sample is recognisable as one, which is what makes the rules work", async () => {
  // The rules about samples were all in place and all dead: nothing ever
  // wrote origin = 'sample', so every check for it compared against a row
  // that did not exist. On a real phone the seven seeded recipes therefore
  // looked exactly like recipes the cook had written, and the Account screen
  // offered to put all seven into their account.
  //
  // This is the shape of that bug in miniature. A sample without its
  // provenance row is indistinguishable from a local recipe, which is why the
  // provenance is written down at seed time rather than inferred.
  const { raw, db } = fresh();
  put(raw, recipe("sample-1", "Seeded"));

  assert.deepEqual(
    (await unadoptedRecipes(db, ALICE)).map((r) => r.id), ["sample-1"],
    "with no provenance it is, correctly, just a recipe nobody has claimed",
  );

  origin(raw, "sample-1", "sample");

  assert.deepEqual(await unadoptedRecipes(db, ALICE), [], "and with it, it is never offered");
  assert.equal(await adoptRecipe(db, ALICE, "sample-1"), false, "nor adoptable");
  await queueLocalChange(db, ALICE, write("sample-1", recipe("sample-1", "Edited"), true));
  assert.equal(await countQueued(db, ALICE), 0, "nor uploadable by any path");
});

test("provenance is never written over another account's, on any path", async () => {
  // Scoping the reads by account is what made this reachable: a row owned by
  // somebody else stopped being FOUND, so the code concluded there was no
  // provenance and wrote its own — taking the row over. A read that sees less
  // than the write touches is how an access check comes to protect nothing.
  const { raw, db } = fresh();
  put(raw, recipe("theirs"));
  raw.prepare(
    `INSERT INTO recipe_origin (recipe_id, origin, account_id, shared, adopted, server_revision)
     VALUES ('theirs', 'local', 'bob', 0, 1, 3)`,
  ).run();

  const owner = () =>
    (raw.prepare(`SELECT account_id FROM recipe_origin WHERE recipe_id = 'theirs'`)
      .get() as { account_id: string }).account_id;

  await assert.rejects(
    () => queueLocalChange(db, ALICE, write("theirs", recipe("theirs", "Alice's"), true)),
    /another account's recipe/,
  );
  assert.equal(owner(), "bob");

  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  await assert.rejects(() => store.markSynced("theirs", 9, false), /another account's recipe/);
  await assert.rejects(
    () => store.putRemote({
      envelope: {
        recipe: recipe("theirs", "From Alice's account"), serverId: "s1", ownerId: ALICE,
        ownerName: null, shared: false,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      },
      revision: 9,
    }),
    /another account's recipe/,
  );
  assert.equal(owner(), "bob");
  assert.equal(
    (raw.prepare(`SELECT title FROM recipes WHERE id = 'theirs'`).get() as { title: string }).title,
    "Soda bread",
    "and the recipe body was not rewritten on the way out either",
  );
});

test("a deletion from the server only ever reaches a recipe that came from it", async () => {
  // The most destructive thing the server can ask of this device, so it is
  // the last place to take a recipe id on trust. The coordinator already
  // refuses to pass on a deletion for anything but a cloud recipe; the store
  // refuses too, because two independent refusals is the right number for an
  // operation that removes a cook's recipe from their library.
  const { raw, db } = fresh();
  put(raw, recipe("mine", "Written on this phone"));
  origin(raw, "mine", "local", 1);
  put(raw, recipe("theirs", "From the account"));
  origin(raw, "theirs", "cloud", 1, 3);

  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  await store.applyRemoteDeletion("mine", 9);
  assert.equal((await store.getLocal("mine"))?.deletedLocally, false, "not the server's to delete");

  await store.applyRemoteDeletion("theirs", 9);
  assert.equal((await store.getLocal("theirs"))?.deletedLocally, true);
  assert.equal((await store.getLocal("theirs"))?.serverRevision, 9);

  // And a recipe this account has never heard of is left alone rather than
  // creating a tombstone for somebody else's row.
  await store.applyRemoteDeletion("unknown", 9);
  assert.equal(await store.getLocal("unknown"), null);
});

test("a column added after a table shipped reaches a database that already has it", async () => {
  // The failure this prevents: a column added to a `CREATE TABLE IF NOT
  // EXISTS` does nothing on a device that already ran the app once. The table
  // is there, the creation is skipped, and the column never appears. Every
  // write then fails, and the app reports it as whatever the error looks like
  // from a distance — in this case "no connection".
  //
  // So the test builds the table as it was BEFORE, runs the migration, and
  // checks the columns are there. Only ADDED_COLUMNS can make that true.
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE recipes (
      id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, category TEXT,
      tags TEXT NOT NULL DEFAULT '[]', search TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, json TEXT NOT NULL
    );
    CREATE TABLE recipe_origin (
      recipe_id TEXT PRIMARY KEY NOT NULL, origin TEXT NOT NULL, account_id TEXT,
      owner_id TEXT, shared INTEGER NOT NULL DEFAULT 0, server_id TEXT,
      server_updated_at TEXT, pulled_at TEXT
    );
    CREATE TABLE sync_conflicts (
      id TEXT PRIMARY KEY NOT NULL, recipe_id TEXT NOT NULL, account_id TEXT NOT NULL,
      mine_json TEXT, theirs_json TEXT, server_revision INTEGER, reason TEXT NOT NULL,
      detected_at INTEGER NOT NULL, resolved_at INTEGER, resolution TEXT
    );
  `);

  migrate(raw);

  const columnsOf = (table: string) =>
    (raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

  assert.ok(columnsOf("recipes").includes("deleted_at"));
  assert.ok(columnsOf("recipe_origin").includes("server_revision"));
  assert.ok(columnsOf("recipe_origin").includes("adopted"));
  assert.ok(columnsOf("sync_conflicts").includes("kind"), "the column the app reads must be there");

  // And the store can actually write through it, which is the thing that
  // broke: a column check that passes while a write still fails proves little.
  const db = adapt(raw);
  await sqliteSyncStore(db, ALICE, LIBRARY, here).recordConflict({
    recipeId: "r1", kind: "delete", mine: null, theirs: recipe("r1", "Theirs"),
    serverRevision: 3, reason: "revision_mismatch", detectedAt: 1, resolvedAt: null,
  });
  const [open] = await listOpenConflicts(db, ALICE);
  assert.equal(open.kind, "delete");

  // Running it again changes nothing, because a half-finished upgrade must be
  // safe to re-run.
  migrate(raw);
  assert.equal((await listOpenConflicts(db, ALICE)).length, 1);
});

test("restoring the account's version writes it, with its revision, in one transaction", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("r1", "What this phone was holding"), 5_000);
  origin(raw, "r1", "cloud", 1, 2);

  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  await store.recordConflict({
    recipeId: "r1", kind: "delete", mine: null, theirs: recipe("r1", "Changed in the account"),
    serverRevision: 9, reason: "revision_mismatch", detectedAt: 5_000, resolvedAt: null,
  });
  const [open] = await listOpenConflicts(db, ALICE);

  await applyResolution(db, ALICE, open, resolve(open, "keep-theirs", 6_000), 6_000);

  // Out of the Trash, AND holding what the account holds. Clearing the
  // deletion alone would leave the old body with the watermark already past
  // the change, so no later pull would ever put it right.
  const local = await store.getLocal("r1");
  assert.equal(local?.deletedLocally, false);
  assert.equal(local?.serverRevision, 9);
  assert.equal(
    (raw.prepare(`SELECT title FROM recipes WHERE id = 'r1'`).get() as { title: string }).title,
    "Changed in the account",
  );
  assert.equal(await countQueued(db, ALICE), 0, "the account already has it; nothing to send");
  assert.equal(await countOpenConflicts(db, ALICE), 0);
});

// ---------------------------------------------------------------------------
// Household recipes
// ---------------------------------------------------------------------------

const sharedEnvelope = (r: Recipe, ownerId = "bob") => ({
  recipe: r, serverId: "srv-" + r.id, ownerId, ownerName: "Bob", shared: true,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
});

test("a shared recipe is readable, and never sendable by any path", async () => {
  const { raw, db } = fresh();
  await putSharedRecipe(db, ALICE, sharedEnvelope(recipe("theirs", "Bob's bread")));

  // It is in the library, like any other recipe.
  assert.equal(
    (raw.prepare(`SELECT title FROM recipes WHERE id='theirs' AND deleted_at IS NULL`)
      .get() as { title: string }).title, "Bob's bread",
  );
  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  const local = await store.getLocal("theirs");
  assert.equal(local?.shared, true);
  assert.equal(local?.origin, "cloud");
  assert.equal(local?.serverRevision, null, "this account has no revision to cite");

  // And nothing this account does to it is ever sent.
  await queueLocalChange(db, ALICE, write("theirs", recipe("theirs", "Edited"), false));
  await queueLocalChange(db, ALICE, write("theirs", recipe("theirs", "Edited"), true));
  await queueLocalChange(db, ALICE, remove("theirs"));
  assert.equal(await countQueued(db, ALICE), 0);

  assert.equal(await adoptRecipe(db, ALICE, "theirs"), false, "nor adoptable");
  assert.deepEqual(await unadoptedRecipes(db, ALICE), [], "nor offered for adoption");
});

test("losing access removes the cached copy and nothing else", async () => {
  const { raw, db } = fresh();
  await putSharedRecipe(db, ALICE, sharedEnvelope(recipe("theirs", "Bob's bread")));
  put(raw, recipe("written-here", "Mine"));
  origin(raw, "written-here", "local", 1);
  put(raw, recipe("my-cloud", "Also mine"));
  origin(raw, "my-cloud", "cloud", 1, 4);

  // A read in which the shared recipe no longer appears.
  const plan = planHouseholdRead([], await heldRecipes(db, ALICE));
  assert.deepEqual(plan.revoke, ["theirs"]);

  assert.equal(await revokeSharedRecipes(db, ALICE, plan.revoke), 1);

  const ids = (raw.prepare(`SELECT id FROM recipes ORDER BY id`).all() as Array<{ id: string }>)
    .map((r) => r.id);
  assert.deepEqual(ids, ["my-cloud", "written-here"], "everything of this cook's own stays");
  assert.equal(
    (raw.prepare(`SELECT COUNT(*) AS n FROM recipe_origin WHERE recipe_id='theirs'`)
      .get() as { n: number }).n, 0, "and no provenance is left pointing at nothing",
  );

  // Hard, not soft: it is not in the cook's Trash, because it was never
  // theirs to throw away.
  assert.deepEqual(await (async () => {
    const rows = raw.prepare(`SELECT id FROM recipes WHERE deleted_at IS NOT NULL`).all();
    return rows;
  })(), []);
});

test("revoking refuses to touch a recipe that is not marked shared", async () => {
  // The guard that makes "lost access" safe to act on: if the household read
  // were ever wrong about an id, the worst it could do is nothing.
  const { raw, db } = fresh();
  put(raw, recipe("mine", "Written here"));
  origin(raw, "mine", "local", 1);

  assert.equal(await revokeSharedRecipes(db, ALICE, ["mine"]), 0);
  assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM recipes`).get() as { n: number }).n, 1);
});

test("save my own copy is a new recipe, queued, with the original untouched", async () => {
  const { raw, db } = fresh();
  const original = recipe("theirs", "Bob's bread");
  await putSharedRecipe(db, ALICE, sharedEnvelope(original));

  const copy = await saveMyOwnCopy(db, ALICE, original, "Bob", "theirs-copy-1", 9_000);

  assert.equal(copy.id, "theirs-copy-1");
  assert.match(copy.source?.reference ?? "", /Copied from Bob’s recipe/);

  // The copy is this account's: in the library, and owed to the server.
  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  const mine = await store.getLocal("theirs-copy-1");
  assert.equal(mine?.shared, false);
  assert.equal(mine?.adopted, true);
  const [queued] = await store.listOutbox();
  assert.equal(queued.recipeId, "theirs-copy-1");
  assert.equal(queued.baseRevision, null, "a new recipe, not a write over anything");

  // And the original is exactly as it was: still shared, still not sendable.
  const theirs = await store.getLocal("theirs");
  assert.equal(theirs?.shared, true);
  assert.equal(
    (raw.prepare(`SELECT title FROM recipes WHERE id='theirs'`).get() as { title: string }).title,
    "Bob's bread",
  );
  assert.equal((await store.listOutbox()).length, 1, "nothing was queued for the original");
});

test("edits to a copy and to the original do not reach each other", async () => {
  const { raw, db } = fresh();
  const original = recipe("theirs", "Bob's bread");
  await putSharedRecipe(db, ALICE, sharedEnvelope(original));
  const copy = await saveMyOwnCopy(db, ALICE, original, "Bob", "theirs-copy-1", 9_000);

  // Alice edits her copy.
  await queueLocalChange(db, ALICE, write(copy.id, { ...copy, title: "My version" }));
  raw.prepare(`UPDATE recipes SET title='My version' WHERE id=?`).run(copy.id);

  // Bob changes his, and the household read brings it down.
  await putSharedRecipe(db, ALICE, sharedEnvelope(recipe("theirs", "Bob's bread, revised")));

  const titles = Object.fromEntries(
    (raw.prepare(`SELECT id, title FROM recipes`).all() as Array<{ id: string; title: string }>)
      .map((r) => [r.id, r.title]),
  );
  assert.equal(titles["theirs"], "Bob's bread, revised");
  assert.equal(titles["theirs-copy-1"], "My version", "Bob's change did not reach Alice's copy");
});

// ---------------------------------------------------------------------------
// Starting again
// ---------------------------------------------------------------------------

test("a full resync drops what the account sent and keeps everything else", async () => {
  const { raw, db } = fresh();
  put(raw, recipe("pulled", "From the account"));
  origin(raw, "pulled", "cloud", 1, 7);
  put(raw, recipe("edited", "Edited here, not sent"));
  origin(raw, "edited", "cloud", 1, 8);
  put(raw, recipe("written-here", "Mine"));
  origin(raw, "written-here", "local", 1);
  put(raw, recipe("sample-1", "A sample"));
  origin(raw, "sample-1", "sample");
  await putSharedRecipe(db, ALICE, sharedEnvelope(recipe("theirs", "Bob's")));

  await queueLocalChange(db, ALICE, write("edited", recipe("edited", "Edited here, not sent")));
  const store = sqliteSyncStore(db, ALICE, LIBRARY, here);
  await store.setWatermark(99);
  await store.recordConflict({
    recipeId: "pulled", kind: "write", mine: recipe("pulled", "Mine"),
    theirs: recipe("pulled", "Theirs"), serverRevision: 7, reason: "x",
    detectedAt: 1, resolvedAt: null,
  });

  const outcome = await fullResync(db, ALICE);

  assert.equal(outcome.keptPending, 1, "an unsent change is not collateral damage");
  assert.equal(await store.getWatermark(), 0, "and the next run asks for everything");

  const ids = (raw.prepare(`SELECT id FROM recipes ORDER BY id`).all() as Array<{ id: string }>)
    .map((r) => r.id);
  assert.ok(ids.includes("edited"), "kept: this device still owes a change for it");
  assert.ok(ids.includes("written-here"), "kept: never the server's to send back");
  assert.ok(ids.includes("sample-1"), "kept: not the account's at all");
  assert.ok(!ids.includes("pulled"), "dropped: the account will send it again");

  assert.equal(await countOpenConflicts(db, ALICE), 1, "the only copy of a refused change survives");
  assert.equal(await countQueued(db, ALICE), 1);
});

test("a full resync is safe to run twice", async () => {
  // Restart-safe: an interrupted rebuild must be finishable by running it
  // again, and a completed one must not punish a second press of the button.
  const { raw, db } = fresh();
  put(raw, recipe("pulled", "From the account"));
  origin(raw, "pulled", "cloud", 1, 7);
  put(raw, recipe("mine", "Written here"));
  origin(raw, "mine", "local", 1);

  const first = await fullResync(db, ALICE);
  const second = await fullResync(db, ALICE);

  assert.equal(first.cleared, 1);
  assert.equal(second.cleared, 0, "nothing left to clear");
  assert.equal(second.keptLocal, 1);
  assert.deepEqual(
    (raw.prepare(`SELECT id FROM recipes`).all() as Array<{ id: string }>).map((r) => r.id),
    ["mine"],
  );
});

test("a resync refuses a library that is not this account's", async () => {
  const { db } = fresh();
  await assert.rejects(
    () => fullResync(db, ALICE, { expected: "recipebox-someone-else.db", active: here }),
    /different library/,
  );
});
