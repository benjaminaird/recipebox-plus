// Library and recipe-model behaviour. Pure logic only — expo-sqlite cannot be
// loaded by the node test runner, so db.ts is exercised on the device instead
// and everything worth asserting lives in query.ts and types.ts.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SAMPLE_RECIPES } from "../src/data/sampleRecipes.ts";
import { buildSearchText, matches, queryLibrary } from "../src/data/query.ts";
import {
  collectCategories,
  collectTags,
  findIngredient,
  flattenSteps,
  formatQuantity,
  stepIngredients,
} from "../src/data/types.ts";

const byId = (id: string) => {
  const r = SAMPLE_RECIPES.find((x) => x.id === id);
  assert.ok(r, `sample recipe ${id} is missing`);
  return r;
};

test("every step reference resolves to an ingredient in the same recipe", () => {
  // The model's whole premise is that a step points at the ingredient list
  // rather than copying a quantity (ADR 0012). A ref that resolves to nothing
  // would silently drop an ingredient from Cook Mode, so this guards the
  // sample data as strictly as it guards the lookup.
  for (const recipe of SAMPLE_RECIPES) {
    for (const section of recipe.sections) {
      for (const step of section.steps) {
        for (const ref of step.ingredientRefs ?? []) {
          assert.ok(
            findIngredient(recipe, ref),
            `${recipe.id} step ${step.id} references unknown ingredient ${ref}`,
          );
        }
      }
    }
  }
});

test("ingredient ids are unique within a recipe", () => {
  for (const recipe of SAMPLE_RECIPES) {
    const ids = recipe.sections.flatMap((s) => s.ingredients.map((i) => i.id));
    assert.equal(new Set(ids).size, ids.length, `${recipe.id} has duplicate ingredient ids`);
  }
});

test("step ids are unique within a recipe", () => {
  for (const recipe of SAMPLE_RECIPES) {
    const ids = recipe.sections.flatMap((s) => s.steps.map((x) => x.id));
    assert.equal(new Set(ids).size, ids.length, `${recipe.id} has duplicate step ids`);
  }
});

test("a step resolves to the quantities on the ingredient list, not its own copy", () => {
  const dal = byId("weeknight-tarka-dal");
  const tarka = dal.sections[1];
  const sizzle = tarka.steps.find((s) => s.id === "s3");
  assert.ok(sizzle);
  const used = stepIngredients(dal, sizzle);
  assert.deepEqual(used.map((i) => i.name), ["ghee", "cumin seeds"]);
  assert.equal(formatQuantity(used[0]), "3 tbsp");
  assert.equal(formatQuantity(used[1]), "1 tsp");
});

test("steps flatten across sections in cooking order", () => {
  const ms = byId("millionaires-shortbread");
  const steps = flattenSteps(ms);
  assert.equal(steps.length, 9);
  assert.equal(steps[0].sectionName, "Shortbread base");
  assert.equal(steps[3].sectionName, "Caramel");
  assert.equal(steps[8].sectionName, "Chocolate top");
  assert.deepEqual(steps.map((s) => s.id), ["s1","s2","s3","s4","s5","s6","s7","s8","s9"]);
});

test("formatQuantity omits parts the source did not give", () => {
  assert.equal(formatQuantity({ id: "i1", name: "basil" }), "");
  assert.equal(formatQuantity({ id: "i2", name: "lemon", amount: "1" }), "1");
  assert.equal(formatQuantity({ id: "i3", name: "cream", amount: "600", unit: "ml" }), "600 ml");
});

test("search covers titles, tags, categories and ingredient names", () => {
  const posset = byId("lemon-posset");
  const text = buildSearchText(posset);
  assert.ok(text.includes("lemon posset"));
  assert.ok(text.includes("desserts"));
  assert.ok(text.includes("double cream"), "ingredient names must be searchable");
  assert.ok(text.includes("make ahead"), "tags must be searchable");
  assert.equal(text, text.toLowerCase(), "search text is pre-lowercased");
});

test("every search term must match, so more words narrow the result", () => {
  const wide = queryLibrary(SAMPLE_RECIPES, { query: "lemon" });
  const narrow = queryLibrary(SAMPLE_RECIPES, { query: "lemon chicken" });
  assert.ok(wide.length > narrow.length, "a second term should narrow the result");
  assert.deepEqual(narrow.map((r) => r.id), ["roast-chicken-lemon-thyme"]);
});

test("search is case insensitive and finds recipes by ingredient", () => {
  const found = queryLibrary(SAMPLE_RECIPES, { query: "CANNELLINI" });
  assert.deepEqual(found.map((r) => r.id), ["tomato-white-bean-soup"]);
});

test("category and tag filters combine", () => {
  const vegetarian = queryLibrary(SAMPLE_RECIPES, { tags: ["Vegetarian"] });
  assert.deepEqual(
    vegetarian.map((r) => r.id).sort(),
    ["tomato-white-bean-soup", "weeknight-tarka-dal"],
  );

  const bothTags = queryLibrary(SAMPLE_RECIPES, { tags: ["Vegetarian", "Weeknight"] });
  assert.deepEqual(
    bothTags.map((r) => r.id).sort(),
    ["tomato-white-bean-soup", "weeknight-tarka-dal"],
  );

  const entrees = queryLibrary(SAMPLE_RECIPES, { category: "Entrées" });
  assert.ok(entrees.every((r) => r.category === "Entrées"));
  assert.ok(entrees.length >= 2);

  const none = queryLibrary(SAMPLE_RECIPES, { category: "Desserts", tags: ["Vegetarian"] });
  assert.equal(none.length, 0, "filters must intersect, not union");
});

test("the library comes back newest first", () => {
  const all = queryLibrary(SAMPLE_RECIPES);
  assert.equal(all.length, SAMPLE_RECIPES.length);
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i - 1].createdAt >= all[i].createdAt, "not ordered newest first");
  }
  assert.equal(all[0].id, "weeknight-tarka-dal", "the most recent sample should lead");
});

test("an empty filter set admits everything", () => {
  for (const recipe of SAMPLE_RECIPES) assert.ok(matches(recipe, {}));
});

test("categories and tags can be collected for the filter bar", () => {
  const categories = collectCategories(SAMPLE_RECIPES);
  assert.ok(categories.includes("Desserts"));
  assert.ok(categories.includes("Entrées"));
  assert.equal(new Set(categories).size, categories.length, "categories must be distinct");

  const tags = collectTags(SAMPLE_RECIPES);
  assert.ok(tags.includes("Vegetarian"));
  assert.equal(new Set(tags).size, tags.length, "tags must be distinct");
});

test("every sample recipe carries attribution and at least one section", () => {
  for (const recipe of SAMPLE_RECIPES) {
    assert.ok(recipe.source, `${recipe.id} has no source (ADR 0020)`);
    assert.ok(recipe.source?.method, `${recipe.id} source has no method`);
    assert.ok(recipe.sections.length > 0, `${recipe.id} has no sections`);
    for (const section of recipe.sections) {
      assert.ok(section.ingredients.length > 0, `${recipe.id} has an empty ingredient list`);
      assert.ok(section.steps.length > 0, `${recipe.id} has a section with no steps`);
    }
  }
});

test("categories are food types, never 'Copycat'", () => {
  for (const recipe of SAMPLE_RECIPES) {
    assert.notEqual(recipe.category, "Copycat", `${recipe.id}: Copycat is a tag, never a category`);
  }
});
