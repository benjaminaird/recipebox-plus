// The journey, as code: write a recipe, plan it at a batch, shop for it.
//
// Each piece has its own tests. These exist because the seams between them
// are where the quantities get lost — a recipe's own units, the batch a meal
// is planned at, and the aggregation that adds them up are three separate
// modules, and nothing else checks that a doubled Thursday dinner buys
// doubled ingredients.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { emptyDraft, recipeFromDraft, type Draft } from "../src/domain/recipeDraft.ts";
import {
  addDays, mealsBySlot, mealsInRange, nextPosition, toDateKey, type PlannedMeal,
} from "../src/domain/plan.ts";
import { buildList } from "../src/domain/shoppingList.ts";
import { presentAmount } from "../src/domain/present.ts";
import { matches } from "../src/data/query.ts";
import { collectTags } from "../src/data/types.ts";
import { ADDED_COLUMNS } from "../src/data/schema.ts";

const draft = (): Draft => ({
  ...emptyDraft("r-new", 1000),
  title: "Test Loaf",
  servings: "2",
  category: "baked goods",
  tags: ["vegetarian"],
  sections: [
    {
      name: "",
      ingredients: [
        { id: "i1", name: "plain flour", amount: "500", unit: "g" },
        { id: "i2", name: "water", amount: "350", unit: "ml" },
        { id: "i3", name: "fine salt", amount: "10", unit: "g" },
        { id: "i4", name: "olive oil", amount: "", unit: "" },
      ],
      steps: [
        { id: "s1", text: "Mix the flour, water and salt.", ingredientRefs: ["i1", "i2", "i3"] },
        { id: "s2", text: "Prove, shape and bake.", ingredientRefs: [] },
      ],
    },
  ],
});

const plannedMeal = (recipeId: string, date: string, scale: number): PlannedMeal => ({
  id: `pm-${recipeId}-${date}-${scale}`,
  date,
  slot: "dinner",
  recipeId,
  scale,
  position: 0,
  createdAt: 0,
  updatedAt: 0,
});

test("a written recipe survives into the plan and the shopping list at its batch", () => {
  const recipe = recipeFromDraft(draft(), 2000);

  // Saved as written: 500 g is 500 g, not 17.6 oz and not 0.5 kg.
  const flour = recipe.sections[0].ingredients.find((i) => i.name === "plain flour")!;
  assert.equal(flour.amount, "500");
  assert.equal(flour.unit, "g");

  // Planned for tomorrow, doubled.
  const tomorrow = addDays(toDateKey(new Date()), 1);
  const meals = [plannedMeal(recipe.id, tomorrow, 2)];
  assert.equal(mealsBySlot(meals, tomorrow).dinner.length, 1);

  // Shopped at that batch.
  const items = buildList(
    mealsInRange(meals, tomorrow, tomorrow).map((m) => ({ recipe, scale: m.scale })),
  );
  const line = (word: string) => items.find((i) => i.text.toLowerCase().includes(word))!;

  assert.match(line("flour").text, /1\s*kg/i, `got "${line("flour").text}"`);
  assert.match(line("water").text, /700\s*ml/i, `got "${line("water").text}"`);
  assert.match(line("salt").text, /20\s*g/i, `got "${line("salt").text}"`);
  // The line with no amount is still on the list, still with no amount.
  assert.ok(line("olive oil"), "an ingredient with no amount must still be bought");
  assert.doesNotMatch(line("olive oil").text, /\d/, `got "${line("olive oil").text}"`);
});

test("the same recipe planned twice buys for both meals", () => {
  const recipe = recipeFromDraft(draft(), 2000);
  const today = toDateKey(new Date());
  const meals = [
    plannedMeal(recipe.id, today, 1),
    plannedMeal(recipe.id, addDays(today, 2), 2),
  ];
  const items = buildList(
    mealsInRange(meals, today, addDays(today, 6)).map((m) => ({ recipe, scale: m.scale })),
  );
  // 500 g + 1000 g.
  const flour = items.find((i) => i.text.toLowerCase().includes("flour"))!;
  assert.match(flour.text, /1\.5\s*kg/i, `got "${flour.text}"`);
});

test("the recipe screen and the shopping list mean the same amount", () => {
  // They do NOT read the same, and should not. At 2x the recipe screen says
  // "1000 g", because Original keeps the unit the recipe was written in; the
  // shopping list says "1 kg", because that is how flour is bought. Both are
  // right for where they are.
  //
  // What must never differ is the QUANTITY. A cook shown one amount and
  // buying another is the failure this guards, so the test compares grams
  // rather than strings.
  const recipe = recipeFromDraft(draft(), 2000);
  const onScreen = presentAmount("500", "g", "plain flour", { scale: 2, measurement: "original" });
  const items = buildList([{ recipe, scale: 2 }]);
  const inList = items.find((i) => i.text.toLowerCase().includes("flour"))!;

  const grams = (text: string): number => {
    const m = /([\d.]+)\s*(kg|g)\b/i.exec(text);
    assert.ok(m, `no weight in "${text}"`);
    return Number(m![1]) * (m![2].toLowerCase() === "kg" ? 1000 : 1);
  };

  assert.equal(grams(onScreen.text), 1000, `screen: "${onScreen.text}"`);
  assert.equal(grams(inList.text), grams(onScreen.text), `screen "${onScreen.text}" vs list "${inList.text}"`);
  // And they really are written differently, which is the point above.
  assert.notEqual(onScreen.text.trim(), inList.text.replace(/plain flour/i, "").trim());
});

test("a recipe written here is findable by its tags and category afterwards", () => {
  const recipe = recipeFromDraft(draft(), 2000);
  assert.equal(recipe.category, "Baked Goods");
  assert.deepEqual(recipe.tags, ["Vegetarian"]);

  // Found by meaning, whatever spelling is used to look.
  for (const spelling of ["Vegetarian", "vegetarian", "VEGETARIAN"]) {
    assert.equal(matches(recipe, { tags: [spelling] }), true, spelling);
  }
  for (const spelling of ["Baked Goods", "baked goods", "BAKED-GOODS"]) {
    assert.equal(matches(recipe, { category: spelling }), true, spelling);
  }
  assert.equal(matches(recipe, { query: "loaf" }), true);
  assert.equal(matches(recipe, { query: "flour" }), true);
  assert.deepEqual(collectTags([recipe]), ["Vegetarian"]);
});

test("removing a planned meal leaves the others alone", () => {
  const today = toDateKey(new Date());
  const meals = [
    plannedMeal("a", today, 1),
    plannedMeal("b", today, 2),
    plannedMeal("c", addDays(today, 1), 1),
  ];
  const after = meals.filter((m) => m.recipeId !== "b");
  assert.deepEqual(mealsBySlot(after, today).dinner.map((m) => m.recipeId), ["a"]);
  assert.deepEqual(mealsBySlot(after, addDays(today, 1)).dinner.map((m) => m.recipeId), ["c"]);
  // And a meal added afterwards does not land on top of a survivor.
  assert.equal(nextPosition(after, today, "dinner"), 1);
});

// ---------------------------------------------------------------------------
// Migration safety
// ---------------------------------------------------------------------------

test("the schema can only ever add, never destroy", () => {
  // The rule that has kept every upgrade from costing a recipe is that the
  // migration only ever adds. For four schema versions that meant nothing but
  // CREATE ... IF NOT EXISTS, and this test said so by banning ALTER outright.
  //
  // Schema 7 needs columns on two tables that already hold rows, and
  // ALTER TABLE ... ADD COLUMN is the one schema change SQLite offers that
  // cannot touch an existing row: it appends a column with a default and
  // rewrites nothing. Banning it did not make upgrades safer — the
  // alternative is a copy-and-swap, which reads every row and writes it
  // somewhere else, and is strictly more dangerous than what was avoided.
  //
  // So the rule is narrowed rather than dropped. The created tables may not
  // contain an ALTER at all; added columns go through ADDED_COLUMNS and
  // addColumn(), which the next two tests hold to adding and nothing else.
  const schema = withoutComments(
    readFileSync(join(import.meta.dirname, "..", "src", "data", "schema.ts"), "utf8"),
  );

  for (const forbidden of [
    /\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i, /\bTRUNCATE\b/i,
    /\bALTER\s+TABLE\b/i, /\bRENAME\s+(TO|COLUMN)\b/i,
  ]) {
    assert.doesNotMatch(schema, forbidden, `schema.ts contains ${forbidden}`);
  }
  // DELETE and UPDATE would rewrite a user's rows on upgrade.
  assert.doesNotMatch(schema, /\bDELETE\s+FROM\b/i, "schema.ts deletes rows");
  assert.doesNotMatch(schema, /\bUPDATE\s+\w+\s+SET\b/i, "schema.ts rewrites rows");

  // Every table it creates is guarded.
  const creates = schema.match(/CREATE\s+TABLE[^(]*/gi) ?? [];
  assert.ok(creates.length > 0, "schema.ts creates no tables");
  for (const stmt of creates) {
    assert.match(stmt, /IF\s+NOT\s+EXISTS/i, `unguarded: ${stmt.trim()}`);
  }
  const indexes = schema.match(/CREATE\s+INDEX[^(]*/gi) ?? [];
  for (const stmt of indexes) {
    assert.match(stmt, /IF\s+NOT\s+EXISTS/i, `unguarded: ${stmt.trim()}`);
  }

  // And migrate() itself runs the schema and adds columns, and does nothing
  // else of its own: a statement smuggled in there would not be covered above.
  const source = readFileSync(join(import.meta.dirname, "..", "src", "data", "db.ts"), "utf8");
  const start = source.indexOf("async function migrate(");
  assert.ok(start > -1, "migrate() not found");
  const body = withoutComments(source.slice(start, source.indexOf("\n}", start)));
  for (const forbidden of [/\bDROP\b/i, /\bDELETE\s+FROM\b/i, /\bALTER\b/i, /\bTRUNCATE\b/i]) {
    assert.doesNotMatch(body, forbidden, `migrate() contains ${forbidden}`);
  }
});

/** TypeScript line and block comments, removed. Strings here hold SQL, not quotes. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

test("a column is only ever added, and only after asking the table", () => {
  // The helper every new column goes through. Two properties make it safe,
  // and both are worth holding: it asks PRAGMA table_info before it acts, so
  // a half-finished upgrade cannot make it add a column twice; and the only
  // statement it issues is ADD COLUMN.
  const source = readFileSync(join(import.meta.dirname, "..", "src", "data", "db.ts"), "utf8");
  const start = source.indexOf("async function addColumn(");
  assert.ok(start > -1, "addColumn() not found");
  const body = withoutComments(source.slice(start, source.indexOf("\n}", start)));

  assert.match(body, /PRAGMA\s+table_info/i, "addColumn() does not ask the table what it has");
  assert.match(body, /ALTER\s+TABLE\s+\$\{table\}\s+ADD\s+COLUMN/i, "addColumn() does not add a column");
  for (const forbidden of [/\bDROP\b/i, /\bDELETE\b/i, /\bUPDATE\b/i, /\bRENAME\b/i]) {
    assert.doesNotMatch(body, forbidden, `addColumn() contains ${forbidden}`);
  }

  // Every column schema 7 added is declared where the migration will find it,
  // rather than added by hand somewhere that escapes the check above.
  for (const [table, column] of [
    ["recipes", "deleted_at"], ["recipe_origin", "server_revision"], ["recipe_origin", "adopted"],
  ]) {
    assert.ok(
      ADDED_COLUMNS.some((c) => c.table === table && c.column === column),
      `${table}.${column} is not in ADDED_COLUMNS`,
    );
  }
  // And nothing in that list is a column on a table the schema does not have.
  const schema = readFileSync(join(import.meta.dirname, "..", "src", "data", "schema.ts"), "utf8");
  for (const { table } of ADDED_COLUMNS) {
    assert.ok(schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} is not created`);
  }
});

test("the outbox survives a migration", () => {
  // A queued change is a promise to the cook that something they wrote will
  // reach their account. Losing the table on an upgrade would break that
  // silently -- the recipe is still on the phone, so nothing looks wrong, and
  // it simply never arrives. The guarantee is structural: every statement in
  // migrate() either creates something that is not there or adds a column, so
  // there is no path through it that can empty a table.
  const schema = withoutComments(
    readFileSync(join(import.meta.dirname, "..", "src", "data", "schema.ts"), "utf8"),
  );

  for (const table of ["sync_outbox", "sync_conflicts"]) {
    assert.ok(
      schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
      `${table} is not created, or is not guarded`,
    );
  }
});

test("every table the app writes carries what a later sync will need", () => {
  // ADR 0006 merges meal plans per day-and-slot and shopping lists per item,
  // with deletions that lose to concurrent edits. All three need per-row
  // identity, per-row timestamps and soft deletes. Getting this wrong is not
  // visible until sync is built, by which point it is a migration.
  const source = readFileSync(join(import.meta.dirname, "..", "src", "data", "schema.ts"), "utf8");
  for (const table of ["planned_meals", "shopping_lists", "shopping_items"]) {
    const start = source.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
    assert.ok(start > -1, `${table} not found`);
    const body = source.slice(start, source.indexOf(");", start));
    assert.match(body, /id\s+TEXT\s+PRIMARY KEY/i, `${table} has no stable id`);
    assert.match(body, /updated_at\s+INTEGER\s+NOT NULL/i, `${table} has no per-row updated_at`);
    assert.match(body, /deleted_at\s+INTEGER/i, `${table} has no tombstone column`);
  }
});

test("every seeded sample is recorded as a sample", () => {
  // Not a behavioural test -- seeding needs a database -- but a check that the
  // one line which writes the fact down is still there and still says
  // 'sample'. It was missing entirely, and because every consumer of it was
  // written first and correctly, nothing failed: the checks simply never
  // matched, and all seven samples were offered for upload on a real phone.
  const source = readFileSync(join(import.meta.dirname, "..", "src", "data", "db.ts"), "utf8");
  const start = source.indexOf("async function markSamples(");
  assert.ok(start > -1, "markSamples() not found: samples would have no provenance");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.match(body, /INSERT INTO recipe_origin[\s\S]*'sample'/i);
  assert.match(body, /ON CONFLICT\(recipe_id\) DO NOTHING/i, "it must not overwrite known provenance");

  // And seeding calls it for the ids already seeded, not only for new ones:
  // an install that already has its samples is the case that needs it.
  const seed = source.slice(source.indexOf("async function seedIfEmpty("));
  const seedBody = seed.slice(0, seed.indexOf("\n}"));
  assert.match(seedBody, /await markSamples\(db, seeded\)/, "existing installs are not backfilled");
  assert.ok(
    seedBody.indexOf("await markSamples(db, seeded)") < seedBody.indexOf("if (missing.length === 0) return;"),
    "the backfill must run before the early return, or it never runs at all",
  );
});
