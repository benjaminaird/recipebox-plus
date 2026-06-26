const assert = require("assert");
const {
  buildShoppingListFromSections,
  groupShoppingItemsByCategory,
  enrichRecipeIngredients,
} = require("../public/shopping-list");

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
assert.ok(findItem(weirdQuantities, "1 heaping tbsp Brown Sugar"), "heaping tablespoon stays descriptive");
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

console.log("shopping-list-test: ok");
