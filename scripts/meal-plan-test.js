const assert = require("assert");
const RecipeBoxTags = require("../public/recipe-tags");

// Mirrors the pure logic in MealPlanner() (src/app.jsx). Keep in sync.
const quickKey = RecipeBoxTags.normalizeTagKey("Quick");
function pickerRecipes(recipes, { search = "", pickFilter = "all" } = {}) {
  return recipes.filter((r) => {
    const q = search.toLowerCase();
    const ms = !q || r.title.toLowerCase().includes(q) || (r.tags || []).some((t) => t.toLowerCase().includes(q));
    const mf = pickFilter === "all"
      || (pickFilter === "favorites" && r.favorite)
      || (pickFilter === "recent" && Date.now() - new Date(r.createdAt).getTime() < 14 * 86400000)
      || (pickFilter === "quick" && (r.tags || []).some((t) => RecipeBoxTags.normalizeTagKey(t) === quickKey));
    return ms && mf;
  });
}
function planned(mealPlan, recipes) {
  const ids = Object.values(mealPlan).flat();
  const rs = ids.map((id) => recipes.find((r) => r.id === id)).filter(Boolean);
  return { mealCount: rs.length, hasMeals: rs.length > 0, uniqueRecipeCount: new Set(rs.map((r) => r.id)).size };
}

const now = Date.now();
const recipes = [
  { id: 1, title: "Weeknight Tacos", category: "Entrées", favorite: true,  createdAt: new Date(now - 1 * 86400e3), tags: ["Quick", "Weeknight"] },
  { id: 2, title: "Sunday Pot Roast", category: "Entrées", favorite: false, createdAt: new Date(now - 30 * 86400e3), tags: ["Comfort Food"] },
  { id: 3, title: "Quick Oats",       category: "Breakfast", favorite: false, createdAt: new Date(now - 2 * 86400e3), tags: ["Quick"] },
];

// Picker filters
assert.strictEqual(pickerRecipes(recipes).length, 3, "all shows everything");
assert.deepStrictEqual(pickerRecipes(recipes, { pickFilter: "favorites" }).map((r) => r.id), [1], "favorites filter");
assert.deepStrictEqual(pickerRecipes(recipes, { pickFilter: "recent" }).map((r) => r.id).sort(), [1, 3], "recent = last 14 days (excludes #2 at 30d)");
assert.deepStrictEqual(pickerRecipes(recipes, { pickFilter: "quick" }).map((r) => r.id).sort(), [1, 3], "quick = recipes tagged Quick");
assert.deepStrictEqual(pickerRecipes(recipes, { search: "roast" }).map((r) => r.id), [2], "search matches title");
assert.deepStrictEqual(pickerRecipes(recipes, { search: "comfort" }).map((r) => r.id), [2], "search matches tag");

// Planned summary derivation
assert.deepStrictEqual(planned({}, recipes), { mealCount: 0, hasMeals: false, uniqueRecipeCount: 0 }, "empty plan");
assert.deepStrictEqual(planned({ Monday: [1], Tuesday: [2, 3] }, recipes), { mealCount: 3, hasMeals: true, uniqueRecipeCount: 3 }, "3 meals across 2 days");
// Same recipe planned on two days counts as 2 meals / 1 recipe.
assert.deepStrictEqual(planned({ Monday: [1], Friday: [1] }, recipes), { mealCount: 2, hasMeals: true, uniqueRecipeCount: 1 }, "repeat recipe -> 2 meals, 1 recipe");
// Deleted recipe ids in the plan are ignored (no crash, not counted).
assert.deepStrictEqual(planned({ Monday: [999] }, recipes), { mealCount: 0, hasMeals: false, uniqueRecipeCount: 0 }, "stale id ignored");

console.log("meal-plan-test: ok");
