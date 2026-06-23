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

console.log("shopping-list-test: ok");
