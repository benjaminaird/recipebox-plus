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

test("the migration can only ever add, never destroy", () => {
  // The rule that has kept every upgrade from costing a recipe is that
  // migrate() contains nothing but CREATE ... IF NOT EXISTS. This reads the
  // real file and holds it to that, because the day someone reaches for an
  // ALTER or a DROP is the day it needs a copy-and-swap and a test that the
  // old rows arrived -- not a quiet edit here.
  const source = readFileSync(join(import.meta.dirname, "..", "src", "data", "db.ts"), "utf8");
  const start = source.indexOf("async function migrate(");
  assert.ok(start > -1, "migrate() not found");
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);

  for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i, /\bALTER\s+TABLE\b/i, /\bTRUNCATE\b/i]) {
    assert.doesNotMatch(body, forbidden, `migrate() contains ${forbidden}`);
  }
  // DELETE and UPDATE would rewrite a user's rows on upgrade.
  assert.doesNotMatch(body, /\bDELETE\s+FROM\b/i, "migrate() deletes rows");
  assert.doesNotMatch(body, /\bUPDATE\s+\w+\s+SET\b/i, "migrate() rewrites rows");

  // Every table it creates is guarded.
  const creates = body.match(/CREATE\s+TABLE[^(]*/gi) ?? [];
  assert.ok(creates.length > 0, "migrate() creates no tables");
  for (const stmt of creates) {
    assert.match(stmt, /IF\s+NOT\s+EXISTS/i, `unguarded: ${stmt.trim()}`);
  }
  const indexes = body.match(/CREATE\s+INDEX[^(]*/gi) ?? [];
  for (const stmt of indexes) {
    assert.match(stmt, /IF\s+NOT\s+EXISTS/i, `unguarded: ${stmt.trim()}`);
  }
});

test("every table the app writes carries what a later sync will need", () => {
  // ADR 0006 merges meal plans per day-and-slot and shopping lists per item,
  // with deletions that lose to concurrent edits. All three need per-row
  // identity, per-row timestamps and soft deletes. Getting this wrong is not
  // visible until sync is built, by which point it is a migration.
  const source = readFileSync(join(import.meta.dirname, "..", "src", "data", "db.ts"), "utf8");
  for (const table of ["planned_meals", "shopping_lists", "shopping_items"]) {
    const start = source.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
    assert.ok(start > -1, `${table} not found`);
    const body = source.slice(start, source.indexOf(");", start));
    assert.match(body, /id\s+TEXT\s+PRIMARY KEY/i, `${table} has no stable id`);
    assert.match(body, /updated_at\s+INTEGER\s+NOT NULL/i, `${table} has no per-row updated_at`);
    assert.match(body, /deleted_at\s+INTEGER/i, `${table} has no tombstone column`);
  }
});
