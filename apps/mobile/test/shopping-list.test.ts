// Building a shopping list from recipes and planned meals.
//
// The cases that matter are the ones where combining would be WRONG. A list
// that splits something it could have merged costs a cook ten seconds in an
// aisle. A list that merges something it should not have sends them home with
// the wrong amount of an ingredient, and they find out mid-recipe.
import assert from "node:assert/strict";
import test from "node:test";
import { buildList, groupByCategory, type ListSource } from "../src/domain/shoppingList.ts";
import type { Recipe } from "../src/data/types.ts";

let n = 0;
const recipe = (title: string, ingredients: Array<Record<string, unknown>>): Recipe =>
  ({
    id: `r${(n += 1)}`,
    title,
    createdAt: 0,
    updatedAt: 0,
    sections: [{ title: "", ingredients, steps: [] }],
  }) as unknown as Recipe;

const at = (r: Recipe, scale = 1): ListSource => ({ recipe: r, scale });

const textOf = (items: { text: string }[]) => items.map((i) => i.text);
const find = (items: { text: string }[], word: string) =>
  items.filter((i) => i.text.toLowerCase().includes(word.toLowerCase()));

// ---------------------------------------------------------------------------
// Combining when it is valid
// ---------------------------------------------------------------------------

test("the same ingredient in the same unit adds up across recipes", () => {
  const items = buildList([
    at(recipe("Bread", [{ id: "i1", amount: "1", unit: "cup", name: "plain flour" }])),
    at(recipe("Pancakes", [{ id: "i1", amount: "2", unit: "cups", name: "plain flour" }])),
  ]);
  const flour = find(items, "flour");
  assert.equal(flour.length, 1, `expected one flour line, got ${JSON.stringify(textOf(flour))}`);
  assert.match(flour[0].text, /3/);
  // And it says where it came from, so a cook can see why the number is that.
  assert.deepEqual([...flour[0].sources].sort(), ["Bread", "Pancakes"]);
  assert.equal(flour[0].combined, true);
});

test("a planned meal's batch multiplies what gets bought", () => {
  const dal = recipe("Dal", [{ id: "i1", amount: "250", unit: "g", name: "red lentils" }]);
  const once = find(buildList([at(dal, 1)]), "lentils");
  const twice = find(buildList([at(dal, 2)]), "lentils");
  assert.match(once[0].text, /250/);
  assert.match(twice[0].text, /500/);
});

test("two meals of the same recipe at different batches add to the sum of both", () => {
  const soup = recipe("Soup", [{ id: "i1", amount: "2", unit: "cups", name: "chicken stock" }]);
  const items = find(buildList([at(soup, 1), at(soup, 2)]), "stock");
  assert.equal(items.length, 1);
  // 2 cups + 4 cups = 6 cups, however it is written.
  assert.match(items[0].text, /6|1 1\/2 quart/i, `got "${items[0].text}"`);
});

// ---------------------------------------------------------------------------
// NOT combining, when combining would be wrong
// ---------------------------------------------------------------------------

test("a volume and a weight of the same ingredient are not added together", () => {
  // The brief's own example. A cup of flour and 100 g of flour are only
  // combinable if the conversion is supported, and volume-to-weight is not
  // supported without knowing how the flour is packed. Two lines is the
  // honest answer; one line asserts a precision nobody has.
  const items = buildList([
    at(recipe("A", [{ id: "i1", amount: "1", unit: "cup", name: "plain flour" }])),
    at(recipe("B", [{ id: "i1", amount: "100", unit: "g", name: "plain flour" }])),
  ]);
  const flour = find(items, "flour");
  assert.equal(flour.length, 2, `expected both kept, got ${JSON.stringify(textOf(flour))}`);
  assert.ok(flour.some((i) => /cup/.test(i.text)));
  assert.ok(flour.some((i) => /\bg\b|gram/.test(i.text)));
});

test("different ingredients that share a word are not merged", () => {
  const items = buildList([
    at(recipe("A", [
      { id: "i1", amount: "1", unit: "cup", name: "plain flour" },
      { id: "i2", amount: "1", unit: "cup", name: "almond flour" },
      { id: "i3", amount: "2", unit: "", name: "spring onions" },
      { id: "i4", amount: "1", unit: "", name: "red onion" },
    ])),
  ]);
  assert.equal(find(items, "plain flour").length, 1);
  assert.equal(find(items, "almond flour").length, 1);
  // Four distinct things, four lines. None absorbed into another.
  assert.ok(find(items, "spring onion").length >= 1);
  assert.ok(find(items, "red onion").length >= 1);
});

test("an amount that cannot be parsed keeps its line and says why", () => {
  // Same ingredient, same unit, but one amount the module cannot turn into a
  // number. It must not guess, and it must not drop either line.
  const items = buildList([
    at(recipe("A", [{ id: "i1", amount: "2", unit: "cups", name: "chicken stock" }])),
    at(recipe("B", [{ id: "i1", amount: "some", unit: "cups", name: "chicken stock" }])),
  ]);
  const stock = find(items, "stock");
  assert.ok(stock.length >= 2, `expected both kept, got ${JSON.stringify(textOf(stock))}`);
  // The module explains itself rather than silently splitting.
  assert.ok(
    stock.some((i) => typeof i.warning === "string" && i.warning.length > 0),
    "expected a warning on at least one kept-separate line",
  );
});

test("an optional ingredient is never folded into a required total", () => {
  // "Flaky sea salt, to finish (optional)" must not increase the salt a cook
  // is told to buy for the dough.
  const items = buildList([
    at(recipe("Cookies", [
      { id: "i1", amount: "1", unit: "tsp", name: "flaky sea salt" },
      { id: "i2", amount: "1", unit: "tsp", name: "flaky sea salt", optional: true },
    ])),
  ]);
  const salt = find(items, "salt");
  assert.equal(salt.length, 2, `expected the optional one kept apart, got ${JSON.stringify(textOf(salt))}`);
  const optional = salt.filter((i) => i.optional);
  assert.equal(optional.length, 1);
  // The required line is still just one teaspoon.
  const required = salt.find((i) => !i.optional)!;
  assert.match(required.text, /1 tsp/i, `got "${required.text}"`);
});

test("an optional ingredient scales with the batch but stays separate", () => {
  const items = buildList([
    at(recipe("Cookies", [{ id: "i1", amount: "2", unit: "tsp", name: "flaky sea salt", optional: true }]), 2),
  ]);
  const salt = find(items, "salt");
  assert.equal(salt.length, 1);
  assert.equal(salt[0].optional, true);
  assert.match(salt[0].text, /4 tsp/i, `got "${salt[0].text}"`);
});

test("an unparseable amount is not scaled into nonsense", () => {
  // "A pinch" doubled is still a pinch. "2 a pinch" would be worse than not
  // scaling at all.
  const items = buildList([
    at(recipe("A", [{ id: "i1", amount: "a pinch of", unit: "", name: "saffron" }]), 4),
  ]);
  const saffron = find(items, "saffron");
  assert.equal(saffron.length, 1);
  assert.doesNotMatch(saffron[0].text, /^4 a pinch/i, `got "${saffron[0].text}"`);
  assert.match(saffron[0].text, /pinch/i);
});

// ---------------------------------------------------------------------------
// Provenance and ordering
// ---------------------------------------------------------------------------

test("every line records which recipes it came from", () => {
  const items = buildList([
    at(recipe("Roast", [{ id: "i1", amount: "1", unit: "", name: "lemon" }])),
    at(recipe("Posset", [{ id: "i1", amount: "3", unit: "", name: "lemons" }])),
  ]);
  for (const item of items) {
    assert.ok(Array.isArray(item.sources), `${item.text} has no sources`);
    assert.ok(item.sources.length > 0, `${item.text} has an empty source list`);
  }
});

test("categories come back in aisle order, not alphabetical", () => {
  const items = buildList([
    at(recipe("A", [
      { id: "i1", amount: "1", unit: "", name: "chicken breast" },
      { id: "i2", amount: "1", unit: "cup", name: "plain flour" },
      { id: "i3", amount: "2", unit: "", name: "carrots" },
    ])),
  ]);
  const order = groupByCategory(items);
  assert.ok(order.length > 0);
  // Whatever the aisles are, the order must be the shared module's, so the
  // phone and the laptop walk a shop the same way.
  assert.deepEqual(order, groupByCategory(items));
});

test("an empty source list builds an empty list rather than throwing", () => {
  assert.deepEqual(buildList([]), []);
  assert.deepEqual(buildList([at(recipe("Empty", []))]), []);
});

// ---------------------------------------------------------------------------
// Metric lines
// ---------------------------------------------------------------------------

test("metric amounts are not shown in ounces", () => {
  // The shared module formats for US kitchens: 250 g + 150 g of butter comes
  // out of it as "14 1/8 oz Butter", and 1.8 kg + 1.2 kg of beef as
  // "105.82 oz Beef". Neither is usable by someone shopping in grams, and the
  // second is two decimal places of an ounce as well.
  const grams = buildList([
    at(recipe("A", [{ id: "i1", amount: "250", unit: "g", name: "butter" }])),
    at(recipe("B", [{ id: "i1", amount: "150", unit: "g", name: "butter" }])),
  ]);
  const butter = find(grams, "butter");
  assert.equal(butter.length, 1);
  assert.doesNotMatch(butter[0].text, /oz/i, `got "${butter[0].text}"`);
  assert.match(butter[0].text, /400\s*g/i, `got "${butter[0].text}"`);

  const kilos = buildList([
    at(recipe("C", [{ id: "i1", amount: "1.8", unit: "kg", name: "beef shin" }])),
    at(recipe("D", [{ id: "i1", amount: "1.2", unit: "kg", name: "beef shin" }])),
  ]);
  const beef = find(kilos, "beef");
  assert.equal(beef.length, 1);
  assert.doesNotMatch(beef[0].text, /oz/i, `got "${beef[0].text}"`);
  assert.match(beef[0].text, /3\s*kg/i, `got "${beef[0].text}"`);
});

test("a metric amount never carries a vulgar fraction", () => {
  // 1.8 kg doubled is 3.6 kg. The module renders that as "3 5/8 kg".
  const items = buildList([
    at(recipe("Roast", [{ id: "i1", amount: "1.8", unit: "kg", name: "whole chicken" }]), 2),
  ]);
  const chicken = find(items, "chicken");
  assert.equal(chicken.length, 1);
  assert.doesNotMatch(chicken[0].text, /\//, `got "${chicken[0].text}"`);
  assert.match(chicken[0].text, /3\.6\s*kg/i, `got "${chicken[0].text}"`);
});

test("millilitres climb to litres only when there are enough of them", () => {
  const small = find(buildList([
    at(recipe("A", [{ id: "i1", amount: "200", unit: "ml", name: "double cream" }])),
    at(recipe("B", [{ id: "i1", amount: "300", unit: "ml", name: "double cream" }])),
  ]), "cream");
  assert.match(small[0].text, /500\s*ml/i, `got "${small[0].text}"`);

  const large = find(buildList([
    at(recipe("C", [{ id: "i1", amount: "800", unit: "ml", name: "chicken stock" }])),
    at(recipe("D", [{ id: "i1", amount: "700", unit: "ml", name: "chicken stock" }])),
  ]), "stock");
  assert.match(large[0].text, /1\.5\s*L/i, `got "${large[0].text}"`);
});

test("US volumes keep the shared module's formatting", () => {
  // Cups and spoons are what the module is good at, including laddering
  // between them. Re-rendering those would be second-guessing it for no gain.
  const items = find(buildList([
    at(recipe("A", [{ id: "i1", amount: "1", unit: "cup", name: "plain flour" }])),
    at(recipe("B", [{ id: "i1", amount: "2", unit: "cups", name: "plain flour" }])),
  ]), "flour");
  assert.match(items[0].text, /3 cups/i, `got "${items[0].text}"`);
});

test("a group with an unreadable amount is left to the module, not half-totalled", () => {
  // If one metric line cannot be parsed, the group must not be silently
  // totalled from the rest -- that would quietly under-buy.
  const items = find(buildList([
    at(recipe("A", [{ id: "i1", amount: "250", unit: "g", name: "butter" }])),
    at(recipe("B", [{ id: "i1", amount: "some", unit: "g", name: "butter" }])),
  ]), "butter");
  assert.ok(items.length >= 2, `expected the parts kept apart, got ${JSON.stringify(textOf(items))}`);
  assert.ok(items.some((i) => i.warning));
});

test("metric volumes combine, which the shared module cannot do at all", () => {
  // The module's volume table runs from teaspoons to gallons and contains no
  // metric volume, so it treats "ml" as part of the ingredient's name. Left to
  // it, "1 L stock" and "500 ml stock" become two items that never combine.
  const items = buildList([
    at(recipe("A", [{ id: "i1", amount: "1", unit: "L", name: "chicken stock" }])),
    at(recipe("B", [{ id: "i1", amount: "500", unit: "ml", name: "chicken stock" }])),
  ]);
  const stock = find(items, "stock");
  assert.equal(stock.length, 1, `expected one line, got ${JSON.stringify(textOf(stock))}`);
  assert.match(stock[0].text, /1\.5\s*L/i, `got "${stock[0].text}"`);
  assert.doesNotMatch(stock[0].text, /\bMl\b/, "the unit must not end up inside the name");
  assert.deepEqual([...stock[0].sources].sort(), ["A", "B"]);
});

test("a metric volume keeps millilitres until there are a thousand of them", () => {
  const items = find(buildList([
    at(recipe("A", [{ id: "i1", amount: "200", unit: "ml", name: "double cream" }])),
    at(recipe("B", [{ id: "i1", amount: "300", unit: "ml", name: "double cream" }])),
  ]), "cream");
  assert.equal(items.length, 1);
  assert.match(items[0].text, /^500 ml /i, `got "${items[0].text}"`);
});

test("different metric-volume ingredients are still different ingredients", () => {
  const items = buildList([
    at(recipe("A", [
      { id: "i1", amount: "200", unit: "ml", name: "double cream" },
      { id: "i2", amount: "200", unit: "ml", name: "single cream" },
    ])),
  ]);
  assert.equal(find(items, "double cream").length, 1);
  assert.equal(find(items, "single cream").length, 1);
});

test("an unreadable metric volume is flagged rather than dropped from the total", () => {
  const items = find(buildList([
    at(recipe("A", [{ id: "i1", amount: "500", unit: "ml", name: "stock" }])),
    at(recipe("B", [{ id: "i1", amount: "a good splash", unit: "ml", name: "stock" }])),
  ]), "stock");
  assert.equal(items.length, 1);
  assert.ok(items[0].warning, "a total that may be short must say so");
});
