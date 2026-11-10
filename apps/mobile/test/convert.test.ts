// Ingredient-aware conversion. The point of these tests is the refusals as
// much as the arithmetic.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { densityFor, knownIngredients, normalizeIngredientName } from "../src/domain/density.ts";
import { convertIngredient } from "../src/domain/convert.ts";
import { formatQuantity } from "../src/domain/quantity.ts";

function value(c: ReturnType<typeof convertIngredient>): number {
  assert.ok(c.ok, "expected a successful conversion");
  const q = (c as { quantity: { kind: string; value?: number; max?: number } }).quantity;
  return q.kind === "range" ? q.max! : q.value!;
}

test("an ingredient name is matched past its handling words", () => {
  assert.equal(normalizeIngredientName("finely chopped dark chocolate"), "dark chocolate");
  assert.equal(normalizeIngredientName("Unsalted Butter, softened"), "butter");
  assert.equal(normalizeIngredientName("  plain flour (sifted) "), "plain flour");
});

test("density is specific to the ingredient, not a single constant", () => {
  const flour = densityFor("plain flour")!;
  const honey = densityFor("honey")!;
  const cocoa = densityFor("cocoa powder")!;
  assert.ok(flour && honey && cocoa);
  // A cup of each weighs very different amounts; that is the whole point.
  assert.ok(honey.gPerMl > flour.gPerMl * 2.5, "honey is far heavier than flour");
  assert.ok(cocoa.gPerMl < flour.gPerMl, "cocoa is far lighter than flour");
});

test("the more specific ingredient wins", () => {
  // Keys are normalised like names, or a key containing a handling word --
  // "whole wheat flour", "chopped nuts" -- becomes unreachable.
  assert.equal(densityFor("whole wheat flour")!.matched, "whole wheat flour");
  assert.ok(densityFor("chopped nuts"), "chopped nuts should resolve");
  assert.equal(densityFor("bread flour")!.matched, "bread flour");
  assert.equal(densityFor("plain flour")!.matched, "plain flour");
  assert.equal(densityFor("icing sugar")!.matched, "icing sugar");
  assert.equal(densityFor("light brown sugar")!.matched, "light brown sugar");
});

test("a key does not match inside an unrelated word", () => {
  // "flour" must not match "cauliflower".
  assert.equal(densityFor("cauliflower"), null);
});

test("an unknown ingredient has no density, and says so", () => {
  for (const name of ["saffron threads", "gochujang", "quince paste", ""]) {
    assert.equal(densityFor(name), null, `${name} should be unknown`);
  }
});

test("a cup of flour converts to about 125 g, not to millilitres", () => {
  const c = convertIngredient("1", "cup", "plain flour", "metric");
  assert.ok(c.ok);
  assert.equal((c as { unit: string }).unit, "g");
  assert.ok(Math.abs(value(c) - 125) < 1, `got ${value(c)}`);
  assert.equal((c as { via?: { matched: string } }).via?.matched, "plain flour");
});

test("the same cup of a different ingredient gives a different weight", () => {
  const flour = value(convertIngredient("1", "cup", "plain flour", "metric"));
  const honey = value(convertIngredient("1", "cup", "honey", "metric"));
  const cocoa = value(convertIngredient("1", "cup", "cocoa powder", "metric"));
  assert.ok(Math.abs(honey - 340) < 1, `honey ${honey}`);
  assert.ok(Math.abs(cocoa - 85) < 1, `cocoa ${cocoa}`);
  // The requirement, as an assertion: cups and grams are not interchangeable.
  assert.notEqual(Math.round(flour), Math.round(honey));
  assert.notEqual(Math.round(flour), Math.round(cocoa));
});

test("an unknown ingredient is not converted to weight on a guess", () => {
  const c = convertIngredient("1", "cup", "gochujang", "metric");
  assert.ok(c.ok, "volume-to-volume is still honest");
  // It becomes millilitres, never grams, because no density is known.
  assert.equal((c as { unit: string }).unit, "ml");
  assert.equal((c as { via?: unknown }).via, undefined);
});

test("counted and descriptive amounts belong to no system", () => {
  for (const [amount, unit, name] of [
    ["2", "eggs", "large eggs"],
    ["1", "pinch", "flaky sea salt"],
    ["3", "cloves", "garlic"],
  ] as const) {
    const c = convertIngredient(amount, unit, name, "metric");
    assert.equal(c.ok, false, `${amount} ${unit} should not convert`);
    assert.equal((c as { reason: string }).reason, "not-measurable");
  }
});

test("an amount with no number does not convert", () => {
  assert.equal(convertIngredient("a splash", "", "olive oil", "metric").ok, false);
  assert.equal(convertIngredient("", "cup", "flour", "metric").ok, false);
});

test("weight converts within its own kind when no density is known", () => {
  // An ingredient with a density goes to cups for US instead; see the
  // dry-goods test below. This is the fallback path.
  const toUs = convertIngredient("500", "g", "gochujang", "us");
  assert.ok(toUs.ok);
  assert.equal((toUs as { unit: string }).unit, "lb");
  assert.ok(Math.abs(value(toUs) - 1.1023) < 0.001, `got ${value(toUs)}`);

  const toMetric = convertIngredient("1", "lb", "gochujang", "metric");
  assert.ok(toMetric.ok);
  assert.equal((toMetric as { unit: string }).unit, "g");
  assert.ok(Math.abs(value(toMetric) - 453.592) < 0.01);
});

test("a system picks a unit of a sensible size", () => {
  // Small metric volumes stay in ml, large ones become litres.
  assert.equal((convertIngredient("2", "cup", "stock", "metric") as { unit: string }).unit, "g");
  assert.equal((convertIngredient("2", "quart", "gochujang", "metric") as { unit: string }).unit, "L");
  // Small US volumes do not become a fraction of a cup.
  assert.equal((convertIngredient("15", "ml", "gochujang", "us") as { unit: string }).unit, "tbsp");
  assert.equal((convertIngredient("5", "ml", "gochujang", "us") as { unit: string }).unit, "tsp");
});

test("converting something already in the target system is a no-op, not a lie", () => {
  const c = convertIngredient("200", "g", "plain flour", "metric");
  assert.equal(c.ok, false);
  assert.equal((c as { reason: string }).reason, "already");
});

test("a range converts at both ends", () => {
  const c = convertIngredient("1-2", "cup", "plain flour", "metric");
  assert.ok(c.ok);
  const q = (c as { quantity: { kind: string; min: number; max: number } }).quantity;
  assert.equal(q.kind, "range");
  assert.ok(Math.abs(q.min - 125) < 1 && Math.abs(q.max - 250) < 1, formatQuantity(q as never));
});

test("conversions render without floating-point artifacts", () => {
  for (const name of ["plain flour", "honey", "butter", "milk", "gochujang"]) {
    for (const unit of ["cup", "tbsp", "tsp"]) {
      const c = convertIngredient("1", unit, name, "metric");
      if (!c.ok) continue;
      const text = formatQuantity((c as { quantity: never }).quantity);
      assert.ok(!text.includes("0000"), `${name} ${unit} -> ${text}`);
      assert.ok(text.length <= 7, `${name} ${unit} -> ${text}`);
    }
  }
});

test("the known-ingredient list is real and inspectable", () => {
  const known = knownIngredients();
  assert.ok(known.length > 40, `only ${known.length} ingredients known`);
  for (const name of known) assert.ok(densityFor(name), `${name} should resolve`);
});

test("US measures dry goods by volume, not by the ounce", () => {
  // 400 g of brown sugar is about two cups. "14.1 oz" is arithmetically
  // correct and useless: no US recipe is written that way.
  const sugar = convertIngredient("400", "g", "light brown sugar", "us");
  assert.ok(sugar.ok);
  assert.equal((sugar as { unit: string }).unit, "cup");
  assert.ok(Math.abs(value(sugar) - 400 / 213) < 0.02, `got ${value(sugar)}`);

  const butter = convertIngredient("230", "g", "unsalted butter", "us");
  assert.equal((butter as { unit: string }).unit, "cup");
  assert.ok(Math.abs(value(butter) - 230 / 227) < 0.02);

  // Small amounts land on spoons rather than a fraction of a cup.
  const salt = convertIngredient("5", "g", "table salt", "us");
  assert.ok(["tsp", "tbsp"].includes((salt as { unit: string }).unit), (salt as { unit: string }).unit);
});

test("an unknown ingredient still falls back to weight, honestly", () => {
  const c = convertIngredient("400", "g", "gochujang", "us");
  assert.ok(c.ok);
  assert.equal((c as { unit: string }).unit, "oz", "no density, so no invented cup measure");
  assert.equal((c as { via?: unknown }).via, undefined);
});

test("round-tripping a conversion returns near the original", () => {
  for (const [grams, name] of [["400", "light brown sugar"], ["230", "butter"], ["280", "plain flour"]] as const) {
    const toUs = convertIngredient(grams, "g", name, "us");
    assert.ok(toUs.ok);
    const back = convertIngredient(
      String(value(toUs)),
      (toUs as { unit: string }).unit,
      name,
      "metric",
    );
    assert.ok(back.ok);
    const delta = Math.abs(value(back) - Number(grams));
    assert.ok(delta < 1, `${grams} g ${name} round-tripped to ${value(back)}`);
  }
});
