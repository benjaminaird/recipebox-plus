// Scaling and conversion as presentation, including divided quantities.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  conversionIsUseful, detectSystem, presentAmount, scaleLabel, SCALES,
} from "../src/domain/present.ts";
import { SAMPLE_RECIPES } from "../src/data/sampleRecipes.ts";
import { flattenSteps, findIngredient } from "../src/data/types.ts";

const orig = { scale: 1, measurement: "original" } as const;

test("the scales offered are the ones asked for", () => {
  assert.deepEqual([...SCALES], [0.5, 1, 2, 3, 4]);
  assert.deepEqual(SCALES.map(scaleLabel), ["½×", "1×", "2×", "3×", "4×"]);
});

test("Original leaves the source's own measurements alone", () => {
  assert.equal(presentAmount("1 1/2", "cups", "plain flour", orig).text, "1 1/2 cups");
  assert.equal(presentAmount("200", "g", "caster sugar", orig).text, "200 g");
  assert.equal(presentAmount("2", "cloves", "garlic", orig).text, "2 cloves");
  assert.equal(presentAmount("a pinch", "", "salt", orig).text, "a pinch");
});

test("scaling multiplies and renders measurable fractions", () => {
  assert.equal(presentAmount("1", "cup", "plain flour", { scale: 0.5, measurement: "original" }).text, "1/2 cup");
  assert.equal(presentAmount("3/4", "cup", "plain flour", { scale: 2, measurement: "original" }).text, "1 1/2 cups");
  assert.equal(presentAmount("230", "g", "butter", { scale: 2, measurement: "original" }).text, "460 g");
  assert.equal(presentAmount("1-2", "tbsp", "olive oil", { scale: 2, measurement: "original" }).text, "2-4 Tbsp");
});

test("words are never scaled into nonsense", () => {
  for (const scale of SCALES) {
    const p = presentAmount("a pinch", "", "flaky sea salt", { scale, measurement: "original" });
    assert.equal(p.text, "a pinch", `at ${scale}x`);
    assert.equal(p.converted, false);
  }
});

test("discrete items stay whole at every scale", () => {
  for (const scale of SCALES) {
    const p = presentAmount("3", "eggs", "large eggs", { scale, measurement: "original" });
    const n = Number(p.amount);
    assert.ok(Number.isInteger(n), `3 eggs at ${scale}x gave ${p.text}`);
    assert.ok(n >= 1, "never scales away to nothing");
  }
  // Halving three eggs gives two, not one and a half.
  assert.equal(presentAmount("3", "eggs", "large eggs", { scale: 0.5, measurement: "original" }).text, "2 eggs");
  assert.equal(presentAmount("1", "egg", "large eggs", { scale: 0.5, measurement: "original" }).text, "1 egg");
});

test("conversion uses the ingredient, and shows its working", () => {
  const flour = presentAmount("1", "cup", "plain flour", { scale: 1, measurement: "metric" });
  assert.equal(flour.text, "125 g");
  assert.ok(flour.converted);
  assert.ok(flour.note?.includes("plain flour"), flour.note);
  assert.ok(flour.note?.includes("spooned"), "states the convention used");

  const honey = presentAmount("1", "cup", "honey", { scale: 1, measurement: "metric" });
  assert.equal(honey.text, "340 g");
});

test("an ingredient with no known density is kept as written, with a reason", () => {
  const p = presentAmount("2", "cup", "gochujang", { scale: 1, measurement: "metric" });
  // Volume to volume is still honest, so it may convert -- but never to grams.
  assert.ok(!p.text.endsWith(" g"), `must not invent a weight: ${p.text}`);
});

test("scaling and conversion compose, and pick a sensible unit", () => {
  // Four cups of stock in metric is a litre's worth, not 946 millilitres.
  const stock = presentAmount("1", "cup", "stock", { scale: 4, measurement: "metric" });
  assert.ok(/kg|g$/.test(stock.unit), stock.text);
  const flour = presentAmount("1", "cup", "plain flour", { scale: 4, measurement: "metric" });
  assert.equal(flour.text, "500 g");
});

test("no scale or conversion leaks floating point", () => {
  for (const scale of SCALES) {
    for (const m of ["original", "us", "metric"] as const) {
      for (const [a, u, n] of [["1/3", "cup", "plain flour"], ["2/3", "cup", "milk"], ["1", "tsp", "salt"]] as const) {
        const text = presentAmount(a, u, n, { scale, measurement: m }).text;
        assert.ok(!/\d{6,}/.test(text), `${a} ${u} ${n} @${scale} ${m} -> ${text}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Divided quantities, end to end against the real sample recipe.
// ---------------------------------------------------------------------------

const COOKIES = SAMPLE_RECIPES.find((r) => r.id === "brown-butter-chocolate-chip-cookies")!;

test("a divided ingredient's shares still sum to the list total when scaled", () => {
  for (const scale of SCALES) {
    const opts = { scale, measurement: "original" } as const;
    const butter = findIngredient(COOKIES, "i1")!;
    const total = Number(presentAmount(butter.amount, butter.unit, butter.name, opts).amount);

    let summed = 0;
    for (const step of flattenSteps(COOKIES)) {
      for (const use of step.ingredientUses ?? []) {
        if (use.id !== "i1") continue;
        summed += Number(
          presentAmount(use.amount, use.unit ?? butter.unit, butter.name, opts).amount,
        );
      }
    }
    assert.equal(summed, total, `at ${scale}x the halves must still make the whole`);
  }
});

test("a divided ingredient converts consistently between list and steps", () => {
  const opts = { scale: 1, measurement: "metric" } as const;
  const chocolate = findIngredient(COOKIES, "i2")!;
  const total = presentAmount(chocolate.amount, chocolate.unit, chocolate.name, opts);
  assert.equal(total.text, "200 g", "already metric, so unchanged");

  const shares = flattenSteps(COOKIES)
    .flatMap((s) => s.ingredientUses ?? [])
    .filter((u) => u.id === "i2")
    .map((u) => presentAmount(u.amount, u.unit ?? chocolate.unit, chocolate.name, opts).text);
  assert.deepEqual(shares, ["150 g", "50 g"]);
});

// ---------------------------------------------------------------------------
// Which system a recipe was written in
// ---------------------------------------------------------------------------

test("a recipe's original system is read from the units it uses", () => {
  assert.equal(detectSystem(["cup", "tbsp", "tsp"]), "us");
  assert.equal(detectSystem(["g", "ml", "kg"]), "metric");
  assert.equal(detectSystem(["cup", "g", "ml", "tbsp"]), "mixed");
  assert.equal(detectSystem(["clove", "egg"]), "unknown", "counted units pick no system");
  assert.equal(detectSystem([]), "unknown");
});

test("a few stragglers do not make a recipe mixed", () => {
  // A metric recipe that still says "1 tsp" is a metric recipe.
  assert.equal(detectSystem(["g", "g", "g", "g", "ml", "ml", "ml", "ml", "tsp"]), "metric");
  assert.equal(detectSystem(["cup", "cup", "cup", "cup", "tbsp", "tsp", "tsp", "tsp", "g"]), "us");
});

test("the sample library is read correctly", () => {
  const units = (id: string) => {
    const r = SAMPLE_RECIPES.find((x) => x.id === id)!;
    return r.sections.flatMap((s) => s.ingredients.map((i) => i.unit));
  };
  assert.equal(detectSystem(units("brown-butter-chocolate-chip-cookies")), "metric");
  assert.equal(detectSystem(units("lemon-posset")), "metric");
});

test("a conversion is only offered when it would say something", () => {
  assert.equal(conversionIsUseful("metric", "us"), true);
  assert.equal(conversionIsUseful("metric", "metric"), false, "no point converting metric to metric");
  assert.equal(conversionIsUseful("us", "us"), false);
  assert.equal(conversionIsUseful("mixed", "metric"), true);
  assert.equal(conversionIsUseful("unknown", "metric"), false);
  assert.equal(conversionIsUseful("metric", "original"), true);
});
