// Scaling and conversion as presentation, including divided quantities.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  conversionIsUseful, detectSystem, measuresAgree, presentAmount, scaleLabel, SCALES,
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

test("the plural follows the number shown, not the one behind it", () => {
  // 230 g of butter is 1.013 cups, which displays as "1" and must read
  // "1 cup". Pluralising from the raw value gave "1 cups".
  const butter = presentAmount("230", "g", "unsalted butter", { scale: 1, measurement: "us" });
  assert.equal(butter.text, "1 cup", butter.text);

  const sugar = presentAmount("400", "g", "light brown sugar", { scale: 1, measurement: "us" });
  assert.equal(sugar.text, "1 7/8 cups", sugar.text);
});

test("a spoon measure is never converted into a weight", () => {
  // The bug this prevents reached the screen: 1/4 tsp of fine sea salt,
  // shown in metric, read "1.42 g". No kitchen scale resolves that, no cook
  // would write it, and the original was perfectly good in both systems.
  const salt = presentAmount("1/4", "tsp", "fine sea salt", { scale: 1, measurement: "metric" });
  assert.equal(salt.text, "1/4 tsp");
  assert.equal(salt.converted, false);

  // Both directions, and tablespoons too.
  // "Tbsp" keeps shopping-list.js's capital, deliberately; see displayUnit.
  assert.equal(presentAmount("1", "tbsp", "flaky sea salt", { scale: 1, measurement: "us" }).text, "1 Tbsp");
  assert.equal(presentAmount("2", "tsp", "vanilla extract", { scale: 1, measurement: "metric" }).text, "2 tsp");

  // Scaling a spoon still works -- it is conversion we are declining, not
  // arithmetic.
  assert.equal(presentAmount("1/4", "tsp", "fine sea salt", { scale: 4, measurement: "metric" }).text, "1 tsp");
});

test("a cup still converts; it is spoons that are shared, not all volume", () => {
  const flour = presentAmount("1", "cup", "plain flour", { scale: 1, measurement: "metric" });
  assert.equal(flour.unit, "g");
  assert.equal(flour.converted, true);
});

test("a converted weight is rounded to something a kitchen can hit", () => {
  // A quarter cup of butter is 56.749999... g. The old formatter showed
  // "56.75", which claims a precision no scale has and reads as a bug.
  const butter = presentAmount("1/4", "cup", "unsalted butter", { scale: 1, measurement: "metric" });
  assert.match(butter.amount, /^\d+$/, `expected a whole number of grams, got "${butter.amount}"`);
  const grams = Number(butter.amount);
  assert.ok(grams >= 50 && grams <= 60, `a quarter cup of butter should be 50-60 g, got ${grams}`);
  assert.equal(grams % 5, 0, "above 50 g, steps of 5 are what recipes are written in");

  // No converted metric amount should ever show two decimal places.
  const names = ["plain flour", "caster sugar", "unsalted butter", "whole milk", "chopped nuts"];
  const amounts = ["1/3", "1/2", "2/3", "1", "1 1/2", "2", "3"];
  for (const name of names) {
    for (const a of amounts) {
      for (const scale of [0.5, 1, 2, 3, 4] as const) {
        const out = presentAmount(a, "cup", name, { scale, measurement: "metric" });
        if (!out.converted) continue;
        if (out.unit === "g" || out.unit === "ml") {
          // A gram is the finest thing a kitchen scale reads, so a decimal
          // here is always noise.
          assert.doesNotMatch(
            out.amount, /\./,
            `${scale}x ${a} cup ${name} -> "${out.text}" claims sub-gram precision`,
          );
        } else {
          // Kilograms and litres carry a decimal legitimately -- 1.15 kg is
          // 1150 g -- but only on a step a recipe would write.
          const v = Number(out.amount);
          assert.ok(Number.isFinite(v), `"${out.text}" is not a number`);
          assert.ok(
            Math.abs(v / 0.05 - Math.round(v / 0.05)) < 1e-9,
            `${scale}x ${a} cup ${name} -> "${out.text}" is off any sensible step`,
          );
        }
      }
    }
  }
});

test("metric amounts use decimals; cups and spoons keep their fractions", () => {
  // A system built on tens does not need vulgar fractions, and nobody writes
  // "1 1/2 kg". Fractions belong to the units measured with cups and spoons.
  const kilo = presentAmount("3", "cup", "plain flour", { scale: 3, measurement: "metric" });
  assert.equal(kilo.unit, "kg");
  assert.doesNotMatch(kilo.amount, /\//, `"${kilo.text}" uses a fraction for a metric unit`);

  assert.equal(presentAmount("1.5", "kg", "whole chicken", { scale: 1, measurement: "original" }).text, "1.5 kg");
  assert.equal(presentAmount("1/2", "kg", "beef shin", { scale: 1, measurement: "original" }).text, "0.5 kg");

  // And the other way: a cup is still halved into a fraction.
  assert.equal(presentAmount("1", "cup", "double cream", { scale: 0.5, measurement: "original" }).text, "1/2 cup");
});

test("a weight hint that only repeats the line above is not a second line", () => {
  // "175 g unsalted butter" with a tagged 175 g weight printed both, one under
  // the other, which reads as a rendering fault rather than as information.
  assert.equal(measuresAgree("175 g", "175g"), true);
  assert.equal(measuresAgree("1 1/2 cups", "1 1/2 Cups"), true);
  // A genuine second measure must survive: a source that says "1 cup (227 g)"
  // is telling the cook something the cup measure does not.
  assert.equal(measuresAgree("1 cup", "227 g"), false);
  assert.equal(measuresAgree("175 g", "180 g"), false);
});

test("a converted cup measure lands on a fraction a cook can measure", () => {
  // 460 g of butter is 2.0299 cups. "2.03 cups" is the same false precision
  // as "1.42 g": nobody owns a measure that reads hundredths of a cup.
  const butter = presentAmount("230", "g", "unsalted butter", { scale: 2, measurement: "us" });
  assert.equal(butter.text, "2 cups", `got "${butter.text}"`);

  // Thirds survive where the measure has them -- a 1/3-cup is a real thing,
  // and snapping it to eighths would be a worse answer, not a tidier one.
  const third = presentAmount("125", "g", "plain flour", { scale: 1, measurement: "us" });
  assert.equal(third.text, "1 cup", `got "${third.text}"`);

  // A spoon measure is moulded in quarters, so eighths of a tablespoon are a
  // number nobody can act on.
  const spoonfuls = presentAmount("80", "g", "caster sugar", { scale: 1, measurement: "us" });
  assert.match(spoonfuls.unit, /tbsp/i, `got "${spoonfuls.text}"`);
  assert.doesNotMatch(spoonfuls.amount, /\/(8|3)$/, `got "${spoonfuls.text}"`);

  // No converted US amount should show hundredths at any batch size.
  const names = ["unsalted butter", "plain flour", "caster sugar", "light brown sugar", "dark chocolate"];
  for (const name of names) {
    for (const grams of ["50", "80", "115", "150", "200", "230", "397"]) {
      for (const scale of [0.5, 1, 2, 3, 4] as const) {
        const out = presentAmount(grams, "g", name, { scale, measurement: "us" });
        if (!out.converted) continue;
        assert.doesNotMatch(
          out.amount, /\.\d\d/,
          `${scale}x ${grams} g ${name} -> "${out.text}" exposes a precision artifact`,
        );
      }
    }
  }
});

test("snapping moves an amount by at most half a mark on the measure", () => {
  // The error has to stay inside what the equipment can resolve, or the
  // tidier number is a different quantity. Checked against raw arithmetic:
  // a cup is marked in eighths, so half a mark is a sixteenth.
  for (const grams of ["40", "60", "90", "125", "175", "250", "300"]) {
    for (const scale of [0.5, 1, 2, 3] as const) {
      const out = presentAmount(grams, "g", "plain flour", { scale, measurement: "us" });
      if (!out.converted || out.unit.indexOf("cup") !== 0) continue;
      const shown = (() => {
        const m = out.amount.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
        if (m) return (m[1] ? Number(m[1]) : 0) + Number(m[2]) / Number(m[3]);
        return Number(out.amount);
      })();
      // 125 g per cup is the density table's value for plain flour.
      const exact = (Number(grams) * scale) / 125;
      assert.ok(
        Math.abs(shown - exact) <= 1 / 16 + 1e-9,
        `${scale}x ${grams} g flour: shown ${shown}, exact ${exact.toFixed(4)}`,
      );
    }
  }
});
