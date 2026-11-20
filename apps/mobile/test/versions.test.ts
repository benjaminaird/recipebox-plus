// Recipe history (ADR 0015) against a real SQLite.
//
// Same reasoning as sqlite-sync-store.test.ts: the part of history that can be
// wrong is the SQL — an ordering that reads the wrong row, an INSERT that
// collides, a sequence that restarts — and none of that is visible against a
// hand-written fake. So this creates the REAL schema from src/data/schema.ts in
// node's own SQLite and drives the real functions against it.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ADDED_COLUMNS, SCHEMA_SQL, SCHEMA_VERSION } from "../src/data/schema.ts";
import {
  appendVersion, causeLabel, countVersions, getVersion, listVersions, originalVersion,
  recordArrival, recordChange, revertNote, revertedContent, type VersionDb,
} from "../src/data/versions.ts";
import type { Recipe } from "../src/data/types.ts";

function adapt(db: DatabaseSync): VersionDb {
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
  };
}

function migrate(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function fresh(): { raw: DatabaseSync; db: VersionDb } {
  const raw = new DatabaseSync(":memory:");
  migrate(raw);
  return { raw, db: adapt(raw) };
}

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  id: "r1",
  title: "Brown Butter Crumble Bars",
  createdAt: 1000,
  updatedAt: 1000,
  sections: [{ ingredients: [{ id: "i1", name: "butter", amount: "1", unit: "cup" }], steps: [{ id: "s1", text: "Brown it." }] }],
  ...over,
});

test("the schema carries the versions table at version 8", () => {
  assert.ok(SCHEMA_VERSION >= 8, "the migration has to run for an existing device to get the table");
  const { raw } = fresh();
  const cols = (raw.prepare("PRAGMA table_info(recipe_versions)").all() as Array<{ name: string }>).map((c) => c.name);
  assert.deepEqual(cols.sort(), ["cause", "created_at", "id", "json", "note", "recipe_id", "seq"]);
  // Run it twice: an upgrade that fails halfway has to be safe to repeat.
  migrate(raw);
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM recipe_versions").get() as { n: number }).n, 0);
});

test("the first version is how the recipe arrived, and is recorded once", async () => {
  const { db } = fresh();
  await recordArrival(db, recipe());
  await recordArrival(db, recipe({ title: "Changed by something careless" }));

  const history = await listVersions(db, "r1");
  assert.equal(history.length, 1, "arrival is recorded once, however often it is asked for");
  assert.equal(history[0].cause, "imported");
  assert.equal(history[0].seq, 1);
  const first = await originalVersion(db, "r1");
  assert.equal(first?.recipe.title, "Brown Butter Crumble Bars", "and the second call did not overwrite it");
});

test("versions append, newest first, and the sequence never restarts", async () => {
  const { db } = fresh();
  await recordArrival(db, recipe(), "As it arrived", 1000);
  await appendVersion(db, { recipe: recipe({ title: "Less sugar" }), cause: "helper", note: "Lower in sugar", at: 2000 });
  await appendVersion(db, { recipe: recipe({ title: "Less sugar, more salt" }), cause: "edited", at: 3000 });

  const history = await listVersions(db, "r1");
  assert.deepEqual(history.map((v) => [v.seq, v.cause]), [[3, "edited"], [2, "helper"], [1, "imported"]]);
  assert.equal(history[1].note, "Lower in sugar", "the note the Helper's change carried");
  assert.equal(await countVersions(db, "r1"), 3);

  // Earlier versions are still exactly what they were.
  assert.equal((await getVersion(db, "r1", 1))?.recipe.title, "Brown Butter Crumble Bars");
  assert.equal((await getVersion(db, "r1", 2))?.recipe.title, "Less sugar");
  assert.equal(await getVersion(db, "r1", 9), null, "a version that does not exist is null, not a throw");
});

test("two recipes keep separate histories", async () => {
  const { db } = fresh();
  await recordArrival(db, recipe());
  await recordArrival(db, recipe({ id: "r2", title: "Other" }));
  await appendVersion(db, { recipe: recipe({ id: "r2", title: "Other, edited" }), cause: "edited" });

  assert.equal(await countVersions(db, "r1"), 1);
  assert.equal(await countVersions(db, "r2"), 2);
  assert.equal((await listVersions(db, "r2"))[0].seq, 2, "each recipe's sequence is its own");
});

test("a repeated append writes the same row rather than a duplicate", async () => {
  const { db, raw } = fresh();
  await recordArrival(db, recipe());
  // The id is derived from the recipe and the sequence, so an append that is
  // somehow retried before the first one is visible cannot double the history.
  await db.runAsync(
    `INSERT OR IGNORE INTO recipe_versions (id, recipe_id, seq, cause, note, created_at, json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ["r1:1", "r1", 1, "imported", "", 1000, "{}"],
  );
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM recipe_versions").get() as { n: number }).n, 1);
  assert.equal((await getVersion(db, "r1", 1))?.recipe.title, "Brown Butter Crumble Bars", "and the original row won");
});

test("nothing in the module rewrites or deletes a version", async () => {
  // The append-only rule, read off the source rather than asserted about
  // behaviour: a future edit that adds an UPDATE or a DELETE here fails this.
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/data/versions.ts", import.meta.url), "utf8"));
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\bUPDATE\s+recipe_versions\b/i.test(code), "no UPDATE of a version");
  assert.ok(!/\bDELETE\s+FROM\s+recipe_versions\b/i.test(code), "no DELETE of a version");
  assert.ok(!/\bDROP\b/i.test(code), "no DROP");
});

test("reverting carries identity forward and dates the revert now", () => {
  const current = recipe({ title: "Current", createdAt: 1000, updatedAt: 5000 });
  const target = recipe({ id: "r1", title: "Version three", createdAt: 999, updatedAt: 3000 });
  const back = revertedContent(current, target, 9000);

  assert.equal(back.title, "Version three", "the earlier content comes back");
  assert.equal(back.id, "r1");
  assert.equal(back.createdAt, 1000, "the recipe did not stop being created when it was created");
  assert.equal(back.updatedAt, 9000,
    "dated now, or the library would sort it back to where it was months ago and look like nothing happened");
  assert.equal(revertNote(3), "Went back to version 3");
});

test("a version body that will not parse is dropped from the list, not deleted", async () => {
  const { db } = fresh();
  await recordArrival(db, recipe());
  await db.runAsync(
    `INSERT INTO recipe_versions (id, recipe_id, seq, cause, note, created_at, json) VALUES (?,?,?,?,?,?,?)`,
    ["r1:2", "r1", 2, "edited", "", 2000, "{not json"],
  );
  assert.equal(await getVersion(db, "r1", 2), null, "unreadable, so not offered to restore");
  assert.equal(await countVersions(db, "r1"), 2, "and still there: deleting it is not ours to do");
  assert.equal((await listVersions(db, "r1")).length, 2, "the list shows the line it can read");
});

test("a cause a newer build wrote reads as something rather than crashing", async () => {
  const { db } = fresh();
  await db.runAsync(
    `INSERT INTO recipe_versions (id, recipe_id, seq, cause, note, created_at, json) VALUES (?,?,?,?,?,?,?)`,
    ["r1:1", "r1", 1, "invented-by-a-later-version", "", 1000, JSON.stringify(recipe())],
  );
  const [only] = await listVersions(db, "r1");
  assert.equal(only.cause, "edited", "an unknown cause degrades rather than breaking the history screen");
});

test("every cause has words a cook would recognise", () => {
  for (const cause of ["imported", "edited", "helper", "resolved-flag", "resolved-conflict", "reverted", "restored"] as const) {
    const label = causeLabel(cause);
    assert.ok(label && !label.includes("-"), `${cause} reads as "${label}", not as an enum`);
  }
  assert.equal(causeLabel("imported"), "As it arrived");
  assert.equal(causeLabel("helper"), "Recipe Helper");
});

// The defect this file did not catch, and the app showed in one tap.
//
// A version holds the recipe AFTER the change, and arrival is only recorded
// when a recipe is created. So the first change to a recipe that was already
// on the phone — every sample, every recipe pulled from the account, every
// recipe that predates this table — wrote one row holding the NEW content, and
// the history screen offered nothing to go back to. One change and what it
// used to say was gone, which is the exact thing ADR 0015 exists to prevent.

test("the first change to a recipe with no history keeps what it replaced", async () => {
  const { db } = fresh();
  const before = recipe({ title: "As the sample shipped", updatedAt: 4_000 });

  await recordChange(db, { previous: before, next: recipe({ title: "Lower in sugar" }), cause: "helper", note: "Lower in sugar", at: 9_000 });

  const history = await listVersions(db, "r1");
  assert.equal(history.length, 2, "there has to be something to go back TO");
  assert.deepEqual(history.map((v) => [v.seq, v.cause]), [[2, "helper"], [1, "imported"]]);
  assert.equal((await getVersion(db, "r1", 1))?.recipe.title, "As the sample shipped");
  assert.equal((await getVersion(db, "r1", 2))?.recipe.title, "Lower in sugar");
  assert.equal(history[1].createdAt, 4_000,
    "dated when that content was last true, not when we noticed we had not recorded it");
  assert.match(history[1].note, /before the first change this phone recorded/);
});

test("a recipe that already has history is not backfilled again", async () => {
  const { db } = fresh();
  await recordArrival(db, recipe(), "As it arrived", 1_000);
  await recordChange(db, { previous: recipe({ title: "v1" }), next: recipe({ title: "v2" }), cause: "edited", at: 2_000 });
  await recordChange(db, { previous: recipe({ title: "v2" }), next: recipe({ title: "v3" }), cause: "edited", at: 3_000 });

  const history = await listVersions(db, "r1");
  assert.deepEqual(history.map((v) => v.seq), [3, 2, 1], "one row per change, no duplicates of what came before");
  assert.equal((await originalVersion(db, "r1"))?.recipe.title, "Brown Butter Crumble Bars", "and the arrival version is still the arrival version");
});

test("a change with nothing before it records only itself", async () => {
  const { db } = fresh();
  await recordChange(db, { previous: null, next: recipe({ title: "Brand new" }), cause: "edited", at: 1_000 });
  assert.equal(await countVersions(db, "r1"), 1, "nothing was replaced, so nothing is backfilled");
});
