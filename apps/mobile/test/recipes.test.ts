// Library and recipe-model behaviour. Pure logic only — expo-sqlite cannot be
// loaded by the node test runner, so db.ts is exercised on the device instead
// and everything worth asserting lives in query.ts and types.ts.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SAMPLE_RECIPES } from "../src/data/sampleRecipes.ts";
import { buildSearchText, matches, openingView, queryLibrary, recentlyAdded, resumableCooks } from "../src/data/query.ts";
import {
  collectCategories,
  collectTags,
  findIngredient,
  flattenSteps,
  formatQuantity,
  stepIngredients,
  stepIngredientUses,
  useChipLabel,
  useQuantityLabel,
  type Recipe,
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
  // Derived, not pinned: adding a sample should not break an ordering test.
  const newest = SAMPLE_RECIPES.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  assert.equal(all[0].id, newest.id, "the most recent sample should lead");
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


// ---------------------------------------------------------------------------
// Divided ingredients.
//
// A ref establishes WHICH ingredient a step touches, never HOW MUCH. These
// guard the three ways a quantity can be arrived at, and in particular that an
// unqualified ref on a shared ingredient is never presented as the step's own
// share.
// ---------------------------------------------------------------------------

const COOKIES = SAMPLE_RECIPES.find((r) => r.id === "brown-butter-chocolate-chip-cookies")!;

function stepById(recipe: typeof COOKIES, id: string) {
  const step = flattenSteps(recipe).find((s) => s.id === id);
  assert.ok(step, `no step ${id}`);
  return step!;
}

test("the library keeps a divided ingredient's full total", () => {
  const butter = findIngredient(COOKIES, "i1")!;
  assert.equal(formatQuantity(butter), "230 g", "the ingredient list shows the whole amount");
  const chocolate = findIngredient(COOKIES, "i2")!;
  assert.equal(formatQuantity(chocolate), "200 g");
});

test("each step shows its own share of a divided ingredient, not the total", () => {
  const browned = stepIngredientUses(COOKIES, stepById(COOKIES, "s1"));
  assert.equal(browned.length, 1);
  assert.equal(browned[0].ingredient.id, "i1");
  assert.equal(browned[0].quantity, "115 g", "half the butter, not 230 g");
  assert.equal(browned[0].basis, "portion");
  assert.equal(browned[0].isTotal, false);

  const rest = stepIngredientUses(COOKIES, stepById(COOKIES, "s2"));
  assert.equal(rest[0].quantity, "115 g", "the other half, stated independently");

  const inDough = stepIngredientUses(COOKIES, stepById(COOKIES, "s5"));
  assert.equal(inDough[0].quantity, "150 g");
  const onTop = stepIngredientUses(COOKIES, stepById(COOKIES, "s6")).find((u) => u.ingredient.id === "i2")!;
  assert.equal(onTop.quantity, "50 g");
});

test("the stated shares add up to the amount in the ingredient list", () => {
  // If they ever stop adding up, the recipe is wrong rather than the renderer.
  for (const [id, total] of [["i1", 230], ["i2", 200]] as const) {
    let summed = 0;
    for (const step of flattenSteps(COOKIES)) {
      for (const use of step.ingredientUses ?? []) {
        if (use.id === id && use.amount) summed += Number(use.amount);
      }
    }
    assert.equal(summed, total, `shares of ${id} should sum to ${total}`);
    assert.equal(findIngredient(COOKIES, id)!.amount, String(total));
  }
});

test("an ingredient used by one step alone shows the whole amount", () => {
  const fold = stepIngredientUses(COOKIES, stepById(COOKIES, "s4"));
  const flour = fold.find((u) => u.ingredient.id === "i3")!;
  assert.equal(flour.basis, "all");
  assert.equal(flour.quantity, "280 g");
  assert.equal(flour.isTotal, false, "unambiguous: this step uses all of it");
});

test("a shared ingredient with no stated share is labelled as a total, not a share", () => {
  // Flaky salt goes into the dough and onto the tops, and the recipe never
  // says how much goes where. Printing "1 tsp" against both steps would tell
  // the cook to use twice what the recipe calls for.
  for (const stepId of ["s4", "s6"]) {
    const salt = stepIngredientUses(COOKIES, stepById(COOKIES, stepId)).find((u) => u.ingredient.id === "i9")!;
    assert.equal(salt.basis, "unspecified", `step ${stepId}`);
    assert.equal(salt.isTotal, true, "must be rendered as the recipe total");
    assert.equal(salt.quantity, "1 tsp");
  }
});

test("a stated use needs no separate ref, and refs are never duplicated", () => {
  // s5 lists only ingredientUses; s6 lists i9 as a ref and i2 as a use.
  assert.deepEqual(
    stepIngredientUses(COOKIES, stepById(COOKIES, "s5")).map((u) => u.ingredient.id),
    ["i2"],
  );
  assert.deepEqual(
    stepIngredientUses(COOKIES, stepById(COOKIES, "s6")).map((u) => u.ingredient.id),
    ["i9", "i2"],
  );
});

test("every stated use points at an ingredient that exists", () => {
  for (const recipe of SAMPLE_RECIPES) {
    for (const step of flattenSteps(recipe)) {
      for (const use of step.ingredientUses ?? []) {
        assert.ok(
          findIngredient(recipe, use.id),
          `${recipe.id} step ${step.id} uses unknown ingredient ${use.id}`,
        );
      }
    }
  }
});

test("recipes without stated uses are unaffected", () => {
  // The whole existing library predates ingredientUses and must resolve as before.
  for (const recipe of SAMPLE_RECIPES.filter((r) => r.id !== COOKIES.id)) {
    for (const step of flattenSteps(recipe)) {
      const resolved = stepIngredientUses(recipe, step);
      assert.deepEqual(
        resolved.map((u) => u.ingredient.id),
        stepIngredients(recipe, step).map((i) => i.id),
        `${recipe.id} ${step.id}`,
      );
      for (const use of resolved) assert.notEqual(use.basis, "portion");
    }
  }
});

test("a total is always labelled as a total where it is shown", () => {
  const salt = stepIngredientUses(COOKIES, stepById(COOKIES, "s4")).find((u) => u.ingredient.id === "i9")!;
  assert.equal(useQuantityLabel(salt), "1 tsp total");
  assert.equal(useChipLabel(salt), "flaky sea salt · 1 tsp total");

  const butter = stepIngredientUses(COOKIES, stepById(COOKIES, "s1"))[0];
  assert.equal(useQuantityLabel(butter), "115 g", "a stated share is never called a total");
  assert.equal(useChipLabel(butter), "115 g unsalted butter");
});

test("an ingredient the source gave no amount for prints its name alone", () => {
  const basil = SAMPLE_RECIPES.find((r) => r.id === "tomato-white-bean-soup")!;
  const step = flattenSteps(basil).find((s) => (s.ingredientRefs ?? []).includes("i9"))!;
  const use = stepIngredientUses(basil, step).find((u) => u.ingredient.id === "i9")!;
  assert.equal(use.quantity, "");
  assert.equal(useQuantityLabel(use), "");
  assert.equal(useChipLabel(use), "basil", "no stray separator or empty total");
});


// ---------------------------------------------------------------------------
// Home dashboard.
//
// Progress rows outlive what they point at, so these guard the joins rather
// than the happy path.
// ---------------------------------------------------------------------------

test("resumable cooks are joined to their recipe, newest first", () => {
  const [a, b] = SAMPLE_RECIPES;
  const cooks = resumableCooks(SAMPLE_RECIPES, [
    { recipeId: a.id, stepIndex: 1, updatedAt: 1000 },
    { recipeId: b.id, stepIndex: 0, updatedAt: 9000 },
  ]);
  assert.deepEqual(cooks.map((c) => c.recipe.id), [b.id, a.id]);
  assert.equal(cooks[1].stepIndex, 1);
  assert.equal(cooks[0].totalSteps, flattenSteps(b).length);
});

test("a progress row for a deleted recipe is dropped, not rendered", () => {
  const cooks = resumableCooks(SAMPLE_RECIPES, [
    { recipeId: "deleted-last-week", stepIndex: 2, updatedAt: 5000 },
  ]);
  assert.deepEqual(cooks, [], "a card that opens nothing is worse than no card");
});

test("a step index past the end of an edited recipe is clamped", () => {
  const recipe = SAMPLE_RECIPES[0];
  const total = flattenSteps(recipe).length;
  const [cook] = resumableCooks(SAMPLE_RECIPES, [
    { recipeId: recipe.id, stepIndex: 999, updatedAt: 1 },
  ]);
  assert.equal(cook.stepIndex, total - 1, "resume on the last step, not past it");

  const [negative] = resumableCooks(SAMPLE_RECIPES, [
    { recipeId: recipe.id, stepIndex: -4, updatedAt: 1 },
  ]);
  assert.equal(negative.stepIndex, 0);
});

test("a recipe with no steps cannot be resumed into", () => {
  const empty = { ...SAMPLE_RECIPES[0], id: "stub", sections: [{ ingredients: [], steps: [] }] };
  const cooks = resumableCooks([...SAMPLE_RECIPES, empty], [
    { recipeId: "stub", stepIndex: 0, updatedAt: 1 },
  ]);
  assert.deepEqual(cooks.map((c) => c.recipe.id), []);
});

test("recently added returns the newest few, in order", () => {
  const recent = recentlyAdded(SAMPLE_RECIPES, 3);
  assert.equal(recent.length, 3);
  for (let i = 1; i < recent.length; i++) {
    assert.ok(recent[i - 1].createdAt >= recent[i].createdAt);
  }
  assert.ok(recentlyAdded([], 4).length === 0, "an empty library is not an error");
  assert.equal(recentlyAdded(SAMPLE_RECIPES, 99).length, SAMPLE_RECIPES.length);
});

test("a default measurement a recipe cannot offer falls back to its own units", () => {
  // The bug: set Metric, open a recipe already written in grams. Metric is
  // hidden from the selector (converting metric to metric says nothing), so
  // the view held a value no pill matched -- three options, none selected,
  // and nothing on screen to say what was being shown.
  const metricRecipe = {
    id: "m", title: "Shortbread", createdAt: 0, updatedAt: 0,
    sections: [{ title: "", ingredients: [
      { id: "i1", amount: "250", unit: "g", name: "plain flour" },
      { id: "i2", amount: "175", unit: "g", name: "unsalted butter" },
    ], steps: [] }],
  } as unknown as Recipe;

  assert.equal(openingView(metricRecipe, "metric").measurement, "original");
  assert.equal(openingView(metricRecipe, "us").measurement, "us");
  assert.equal(openingView(metricRecipe, "original").measurement, "original");

  const usRecipe = {
    id: "u", title: "Cookies", createdAt: 0, updatedAt: 0,
    sections: [{ title: "", ingredients: [
      { id: "i1", amount: "2", unit: "cup", name: "plain flour" },
      { id: "i2", amount: "1", unit: "cup", name: "caster sugar" },
    ], steps: [] }],
  } as unknown as Recipe;
  assert.equal(openingView(usRecipe, "metric").measurement, "metric");
  assert.equal(openingView(usRecipe, "us").measurement, "original");

  // A recipe we cannot classify gets no conversion imposed on it either.
  const vague = {
    id: "v", title: "Soup", createdAt: 0, updatedAt: 0,
    sections: [{ title: "", ingredients: [{ id: "i1", name: "a handful of parsley" }], steps: [] }],
  } as unknown as Recipe;
  assert.equal(openingView(vague, "metric").measurement, "original");
  assert.equal(openingView(null, "metric").measurement, "original");

  // And a batch is never inherited: 1x always, whatever the default.
  for (const pref of ["original", "us", "metric"] as const) {
    assert.equal(openingView(usRecipe, pref).scale, 1);
  }
});
