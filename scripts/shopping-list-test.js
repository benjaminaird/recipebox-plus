const assert = require("assert");
const {
  buildShoppingListFromSections,
  groupShoppingItemsByCategory,
  enrichRecipeIngredients,
  normalizeIngredientName,
  sanitizeShoppingList,
  sanitizePantry,
  groupCompoundIngredients,
  abbreviateUnit,
} = require("../public/shopping-list");

// ── Canonical unit abbreviations (used by card, shopping list, scaled, PDF) ──
const U = (u, a) => abbreviateUnit(u, a);
assert.strictEqual(U("teaspoon"), "tsp");
assert.strictEqual(U("teaspoons"), "tsp");
assert.strictEqual(U("tablespoon"), "Tbsp");
assert.strictEqual(U("tablespoons"), "Tbsp");
assert.strictEqual(U("tbsp"), "Tbsp", "lowercase tbsp standardizes to Tbsp");
assert.strictEqual(U("T"), "Tbsp", "capital T = tablespoon");
assert.strictEqual(U("t"), "tsp", "lowercase t = teaspoon");
assert.strictEqual(U("ounce"), "oz");
assert.strictEqual(U("ounces"), "oz");
assert.strictEqual(U("fluid ounces"), "fl oz");
assert.strictEqual(U("pound"), "lb");
assert.strictEqual(U("pounds"), "lb");
assert.strictEqual(U("pint"), "pt");
assert.strictEqual(U("quart"), "qt");
assert.strictEqual(U("gallon"), "gal");
assert.strictEqual(U("milliliters"), "ml");
assert.strictEqual(U("liter"), "L");
assert.strictEqual(U("grams"), "g");
assert.strictEqual(U("kilogram"), "kg");
// cup pluralizes naturally; >1 is plural, fractions/1 are singular.
assert.strictEqual(U("cups", "2"), "cups");
assert.strictEqual(U("cup", "1"), "cup");
assert.strictEqual(U("cups", "3/4"), "cup", "3/4 cup is singular");
assert.strictEqual(U("cup", "2 1/2"), "cups");
// Count/unknown units are never abbreviated; names are never touched.
assert.strictEqual(U("clove"), "clove");
assert.strictEqual(U("large"), "large");
assert.strictEqual(U("can"), "can");
assert.strictEqual(U("heaping tablespoon"), "heaping Tbsp", "descriptor preserved, base abbreviated");
assert.strictEqual(U(""), "");
assert.strictEqual(U(null), "");

function findItem(items, text) {
  return items.find((item) => item.text.toLowerCase().includes(text.toLowerCase()));
}

const lemonLush = [{
  name: "Crust",
  ingredients: [
    { amount: "1", unit: "cup", name: "all-purpose flour" },
    { amount: "1/2", unit: "cup", name: "salted butter melted" },
    { amount: "1/2", unit: "cup", name: "pecans pecans chopped" },
    { amount: "2", unit: "cups", name: "powdered sugar" },
  ],
}, {
  name: "Cream Cheese Layer",
  ingredients: [
    { amount: "8", unit: "oz", name: "cream cheese softened" },
    { amount: "1/2", unit: "cup", name: "powdered sugar" },
    { amount: "1/4", unit: "cup", name: "salted butter cubed" },
  ],
}, {
  name: "Lemon Layer",
  ingredients: [
    { amount: "1", unit: "cup", name: "lemon juice" },
    { amount: "2", unit: "tbsp", name: "lemon juice" },
    { amount: "2", unit: "", name: "lemons, zested" },
    { amount: "3", unit: "tbsp", name: "cornstarch" },
    { amount: "1", unit: "cup", name: "granulated sugar" },
    { amount: "1", unit: "pinch", name: "salt" },
  ],
}];

const items = buildShoppingListFromSections(lemonLush);

assert.strictEqual(items.filter((item) => /powdered sugar/i.test(item.text)).length, 1);
assert.match(findItem(items, "powdered sugar").text, /^2 1\/2 cups Powdered Sugar$/);
assert.match(findItem(items, "lemon juice").text, /^1 1\/8 cups Lemon Juice$/);
assert.match(findItem(items, "salted butter").text, /^3\/4 cup Salted Butter \(melted, cubed\)$/);
assert.ok(findItem(items, "Pecans (chopped)"), "duplicate words are removed from pecans and prep notes are preserved");
assert.ok(findItem(items, "Lemons"), "lemon zest/count stays separate from lemon juice");
assert.strictEqual(findItem(items, "Powdered Sugar").category, "Baking");
assert.strictEqual(findItem(items, "Cream Cheese").category, "Dairy & Eggs");
assert.strictEqual(findItem(items, "Lemon Juice").category, "Produce");
assert.ok(groupShoppingItemsByCategory(items).some((group) => group.category === "Baking"));

const ambiguous = buildShoppingListFromSections([{
  name: "Main",
  ingredients: [
    { amount: "1", unit: "cup", name: "milk" },
    { amount: "1", unit: "cup", name: "almond milk" },
    { amount: "2", unit: "large", name: "eggs" },
    { amount: "1", unit: "pinch", name: "salt" },
    { amount: "", unit: "", name: "salt to taste" },
  ],
}]);

assert.strictEqual(ambiguous.filter((item) => /milk/i.test(item.text)).length, 2);
assert.ok(findItem(ambiguous, "2 Large Eggs"), "size adjectives stay with the ingredient name");
assert.ok(ambiguous.filter((item) => /salt/i.test(item.text)).length >= 2);

const enriched = enrichRecipeIngredients({ sections: [{ name: "Main", ingredients: ["2 cups flour flour"] }] });
assert.strictEqual(enriched.sections[0].ingredients[0].normalized_ingredient_name, "flour");
assert.strictEqual(enriched.sections[0].ingredients[0].raw_text, "2 cups flour flour");

const weirdQuantities = buildShoppingListFromSections([{
  name: "Main",
  ingredients: [
    "1/3 cup + 3 Tablespoons sugar",
    "1 heaping Tbsp brown sugar",
    "1 scant cup flour",
    { amount: "1", unit: "stick", name: "butter" },
  ],
}]);

assert.ok(findItem(weirdQuantities, "1/3 cup + 3 Tablespoons Sugar"), "compound measures stay readable");
assert.ok(!weirdQuantities.some((item) => /31\s*tbsp/i.test(item.text)), "compound measures are not collapsed into confusing tablespoons");
assert.ok(findItem(weirdQuantities, "1 heaping Tbsp Brown Sugar"), "heaping tablespoon stays descriptive, unit standardized to Tbsp");
assert.ok(findItem(weirdQuantities, "1 scant cup Flour"), "scant cup stays descriptive");
assert.ok(findItem(weirdQuantities, "1 stick Butter"), "stick butter remains a count measure");

// ── Multi-recipe shopping lists (combined, source-aware, conservative) ──
function srcSections(recipes) {
  return recipes.flatMap((r) =>
    (r.sections || []).map((s) => ({
      name: r.title,
      ingredients: (s.ingredients || []).map((i) => ({ ...i, source: { id: r.id, title: r.title } })),
    })),
  );
}
const cake = {
  id: "a", title: "Chocolate Cake",
  sections: [{ name: "Batter", ingredients: [
    { amount: "1", unit: "cup", name: "sugar" },
    { amount: "1", unit: "cup", name: "heavy cream" },
    { amount: "1", unit: "cup", name: "semi-sweet chocolate chips" },
    { amount: "2", unit: "cloves", name: "garlic" },
  ] }],
};
const frosting = {
  id: "b", title: "Cream Frosting",
  sections: [{ name: "Frosting", ingredients: [
    { amount: "1/2", unit: "cup", name: "sugar" },
    { amount: "1", unit: "cup", name: "whole milk" },
    { amount: "1", unit: "cup", name: "half-and-half" },
    { amount: "1", unit: "cup", name: "white chocolate chips" },
    { amount: "4", unit: "cloves", name: "garlic" },
  ] }],
};
const multi = buildShoppingListFromSections(srcSections([cake, frosting]));

// Simple identical ingredients combine across recipes...
const sugarItem = findItem(multi, "sugar");
assert.match(sugarItem.text, /^1 1\/2 cups Sugar$/, "sugar combines across recipes");
assert.strictEqual(sugarItem.sourceCount, 2, "combined sugar knows it came from 2 recipes");
assert.deepStrictEqual(sugarItem.sources.map((s) => s.title).sort(), ["Chocolate Cake", "Cream Frosting"]);
assert.match(findItem(multi, "garlic").text, /^6 clove[s]? Garlic$/, "garlic cloves combine across recipes");

// ...but dairy types that affect outcome must NOT merge.
assert.ok(findItem(multi, "Heavy Cream"), "heavy cream stays separate");
assert.ok(findItem(multi, "Whole Milk"), "whole milk stays separate");
assert.ok(findItem(multi, "Half-And-Half") || findItem(multi, "Half And Half"), "half-and-half stays separate");
assert.strictEqual(
  multi.filter((i) => /cream|milk|half/i.test(i.text)).length, 3,
  "heavy cream, whole milk, and half-and-half remain three separate items",
);

// Different chocolate varieties stay separate.
assert.ok(findItem(multi, "Semi-Sweet Chocolate Chips"), "semi-sweet chips stay separate");
assert.ok(findItem(multi, "White Chocolate Chips"), "white chips stay separate");

// A single-source item carries its one source.
assert.strictEqual(findItem(multi, "Heavy Cream").sourceCount, 1);
assert.strictEqual(findItem(multi, "Heavy Cream").sources[0].title, "Chocolate Cake");

// Single-recipe lists still work (shape unchanged, at most one source each).
const singleSrc = buildShoppingListFromSections(srcSections([cake]));
assert.ok(singleSrc.length > 0 && singleSrc.every((i) => i.sourceCount <= 1), "single-recipe list shape is unchanged");

// ── Pantry-aware exclusion: matches a saved staple by normalized name ──
const oilList = buildShoppingListFromSections([{ name: "Main", ingredients: [{ amount: "2", unit: "tbsp", name: "olive oil" }] }]);
const oil = oilList[0];
assert.strictEqual(oil.parts[0].normalized_ingredient_name, normalizeIngredientName("olive oil"), "item exposes a normalized name for pantry matching");
const pantry = new Set([normalizeIngredientName("olive oil")]);
assert.ok(pantry.has(oil.parts[0].normalized_ingredient_name), "an olive oil item is excluded by an olive oil pantry staple");
assert.ok(!pantry.has(normalizeIngredientName("extra virgin olive oil")), "a different variety is NOT matched (conservative exclusion)");

// ── localStorage tamper / corruption resilience ──
// A tampered or corrupt persisted value (valid JSON of the wrong type) must
// never crash the UI — sanitizers always return the correct shape.
const SHAPE = ["title", "recipeIds", "manualItems", "checked", "removed", "edits"];
for (const bad of [null, undefined, 42, "evil", true, [], [1, 2], { recipeIds: "evil" }, { checked: "x", manualItems: "y" }]) {
  const s = sanitizeShoppingList(bad);
  assert.deepStrictEqual(Object.keys(s).sort(), [...SHAPE].sort(), "sanitized list has exactly the expected fields for input " + JSON.stringify(bad));
  assert.ok(Array.isArray(s.recipeIds) && Array.isArray(s.manualItems), "arrays stay arrays");
  assert.ok(s.checked && typeof s.checked === "object" && !Array.isArray(s.checked), "checked stays an object");
  // The dangerous case: a tampered string where an array is expected must not throw on .map.
  assert.doesNotThrow(() => s.recipeIds.map((x) => x), "recipeIds is always mappable");
}
// A real list round-trips intact.
const good = { title: "T", recipeIds: ["a", "b"], manualItems: [{ id: "1", text: "x" }], checked: { k: true }, removed: {}, edits: {} };
assert.deepStrictEqual(sanitizeShoppingList(good), good, "valid list passes through unchanged");
// manualItems entries that aren't objects are dropped.
assert.deepStrictEqual(sanitizeShoppingList({ manualItems: [{ id: "1" }, "junk", null, 5] }).manualItems, [{ id: "1" }]);
// Pantry: only strings survive; non-arrays -> [].
assert.deepStrictEqual(sanitizePantry(["olive oil", 5, null, "salt", {}]), ["olive oil", "salt"]);
assert.deepStrictEqual(sanitizePantry("evil"), []);
assert.deepStrictEqual(sanitizePantry(null), []);

// ── Compound-measure grouping for recipe-card display ──
// "1/3 cup + 3 Tbsp granulated sugar" should render on one line, not two.
const compound = groupCompoundIngredients([
  { amount: "1/3", unit: "cup", name: "granulated sugar" },
  { amount: "3", unit: "Tbsp", name: "granulated sugar" },
  { amount: "2", unit: "large", name: "eggs" },
]);
assert.strictEqual(compound.length, 2, "the two sugar measures collapse into one group; eggs is its own");
assert.strictEqual(compound[0].items.length, 2, "both sugar measures grouped");
assert.strictEqual(normalizeIngredientName(compound[0].name), normalizeIngredientName("granulated sugar"));
assert.strictEqual(compound[1].items.length, 1, "eggs stays single");

// Same unit + same name = two separate listings, NOT merged (e.g. used twice).
const sameUnit = groupCompoundIngredients([
  { amount: "1", unit: "cup", name: "flour" },
  { amount: "1", unit: "cup", name: "flour" },
]);
assert.strictEqual(sameUnit.length, 2, "same-unit repeats are left as separate lines");

// Different ingredients never merge.
const diff = groupCompoundIngredients([
  { amount: "1", unit: "cup", name: "sugar" },
  { amount: "2", unit: "tbsp", name: "butter" },
]);
assert.strictEqual(diff.length, 2);

// An unmeasured second line (e.g. "salt to taste") is not merged into a measure.
const unmeasured = groupCompoundIngredients([
  { amount: "1", unit: "tsp", name: "salt" },
  { amount: "", unit: "", name: "salt" },
]);
assert.strictEqual(unmeasured.length, 2, "an unmeasured same-name line stays separate");

assert.deepStrictEqual(groupCompoundIngredients([]), [], "empty list -> empty groups");

console.log("shopping-list-test: ok");
