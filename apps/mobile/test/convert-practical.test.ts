// Conversions a cook could act on, and the difference between an exact one
// and an estimate.
//
// The case that prompted this: 1.2 kg of strong flour, doubled, displayed as
// "19.3 cups". The arithmetic was right. Nobody has a 19.3-cup measure, and a
// US recipe at that size weighs its flour.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { convertIngredient } from "../src/domain/convert.ts";
import { presentAmount, presentedText } from "../src/domain/present.ts";

function us(amount: string, unit: string, name: string) {
  return convertIngredient(amount, unit, name, "us");
}

// ---------------------------------------------------------------------------
// Large weights keep being weights
// ---------------------------------------------------------------------------

test("a kilo and more of flour is pounds, not a pile of cups", () => {
  const result = us("1.2", "kg", "strong flour");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.unit, "lb", "the useful US unit at this size");
  assert.equal(result.approximate, false, "and a pound is exact arithmetic, not a density estimate");
});

test("the quantity that started this no longer reads as 19.3 cups", () => {
  // 1.2 kg at 2x, which is what the recipe screen was showing.
  const shown = presentAmount("1.2", "kg", "strong flour", { scale: 2, measurement: "us" });
  assert.ok(!/cup/.test(shown.text), "no cups: " + shown.text);
  assert.ok(/lb/.test(shown.text), "pounds instead: " + shown.text);
  assert.equal(shown.approximate, false);
});

test("recipe-sized weights still become cups, which was always the point", () => {
  const sugar = us("400", "g", "brown sugar");
  assert.equal(sugar.ok, true);
  if (!sugar.ok) return;
  assert.equal(sugar.unit, "cup", "400 g of sugar is about two cups, and US recipes say cups");
  assert.equal(sugar.approximate, true, "and it rests on how much a cup of sugar weighs");

  const flour = us("250", "g", "all-purpose flour");
  assert.equal(flour.ok, true);
  if (!flour.ok) return;
  assert.equal(flour.unit, "cup");
});

test("the ceiling is where it says it is, and not a cliff in the middle of a recipe", () => {
  // Eight cups of flour is about 1 kg at 125 g a cup. Either side of that.
  const under = us("900", "g", "all-purpose flour");
  const over = us("1.5", "kg", "all-purpose flour");
  assert.equal(under.ok && under.unit, "cup", "a big bake still reads in cups");
  assert.equal(over.ok && over.unit, "lb", "a commercial quantity does not");
});

// ---------------------------------------------------------------------------
// Large volumes climb the ladder instead of stacking cups
// ---------------------------------------------------------------------------

test("a lot of stock is quarts and gallons, not sixteen cups", () => {
  const twoLitres = convertIngredient("2", "L", "chicken stock", "us");
  assert.equal(twoLitres.ok, true);
  if (!twoLitres.ok) return;
  assert.equal(twoLitres.unit, "quart", "2 L is a bit over two quarts");
  assert.equal(twoLitres.approximate, false, "volume to volume needs no ingredient knowledge");

  const fourLitres = convertIngredient("4", "L", "chicken stock", "us");
  assert.equal(fourLitres.ok && fourLitres.unit, "gallon");
});

test("ordinary liquid amounts still read in cups", () => {
  const halfLitre = convertIngredient("500", "ml", "water", "us");
  assert.equal(halfLitre.ok && halfLitre.unit, "cup", "500 ml is about two cups and should say so");
  const litre = convertIngredient("1", "L", "water", "us");
  assert.equal(litre.ok && litre.unit, "cup", "a litre is four cups, which recipes write as cups");
});

// ---------------------------------------------------------------------------
// Exact versus estimated
// ---------------------------------------------------------------------------

test("a conversion that needs an ingredient is marked approximate; one that does not is not", () => {
  const estimate = us("200", "g", "all-purpose flour");
  assert.equal(estimate.ok && estimate.approximate, true, "grams to cups depends on the flour");

  const exact = convertIngredient("500", "ml", "water", "us");
  assert.equal(exact.ok && exact.approximate, false, "millilitres to cups does not");

  const metricEstimate = convertIngredient("2", "cup", "all-purpose flour", "metric");
  assert.equal(metricEstimate.ok && metricEstimate.approximate, true, "cups to grams depends on the flour too");

  // Water is in the density table, but a metric recipe pours water rather
  // than weighing it, so this never reaches the density at all: it is
  // volume to volume, and exact.
  const water = convertIngredient("2", "cup", "water", "metric");
  assert.equal(water.ok && water.unit, "ml", "a liquid stays a liquid");
  assert.equal(water.ok && water.approximate, false, "and needs no density, so it is not hedged");
});

test("the screen is told, and told in words, when a number is an estimate", () => {
  const estimated = presentAmount("200", "g", "all-purpose flour", { scale: 1, measurement: "us" });
  assert.equal(estimated.approximate, true);
  assert.ok(/approximate/i.test(estimated.note ?? ""), "the note says so: " + estimated.note);
  assert.ok(/flour/i.test(estimated.note ?? ""), "and what it assumed: " + estimated.note);

  const exact = presentAmount("500", "ml", "water", { scale: 1, measurement: "us" });
  assert.equal(exact.approximate, false);
  assert.ok(!/approximate/i.test(exact.note ?? ""), "an exact conversion is not hedged: " + exact.note);
});

test("an ingredient with no known density is still left alone and explained", () => {
  const unknown = presentAmount("300", "g", "sumac", { scale: 1, measurement: "us" });
  assert.ok(/oz|lb/.test(unknown.text), "it converts by weight, which needs no density: " + unknown.text);
  assert.equal(unknown.approximate, false);
});

// ---------------------------------------------------------------------------
// The original is never touched
// ---------------------------------------------------------------------------

test("presentation never rewrites what the recipe says", () => {
  // The same input through three different views; the stored recipe is the
  // argument, and nothing about it changes.
  const amount = "1.2";
  const unit = "kg";
  for (const options of [
    { scale: 1 as const, measurement: "original" as const },
    { scale: 2 as const, measurement: "us" as const },
    { scale: 4 as const, measurement: "metric" as const },
  ]) {
    const shown = presentAmount(amount, unit, "strong flour", options);
    assert.ok(shown.text.length > 0);
  }
  assert.equal(amount, "1.2", "the caller's amount is untouched");
  assert.equal(unit, "kg", "and so is the unit");

  const original = presentAmount(amount, unit, "strong flour", { scale: 1, measurement: "original" });
  assert.ok(/1\.2\s*kg/.test(original.text), "Original still shows what was written: " + original.text);
});

// ---------------------------------------------------------------------------
// The mark the cook actually sees
// ---------------------------------------------------------------------------

test("an estimate is marked on screen and an exact conversion is not", () => {
  const estimate = presentAmount("200", "g", "all-purpose flour", { scale: 1, measurement: "us" });
  assert.ok(presentedText(estimate).startsWith("~"), "marked: " + presentedText(estimate));

  const exact = presentAmount("500", "ml", "water", { scale: 1, measurement: "us" });
  assert.ok(!presentedText(exact).startsWith("~"), "unmarked: " + presentedText(exact));

  const untouched = presentAmount("1.2", "kg", "strong flour", { scale: 1, measurement: "original" });
  assert.ok(!presentedText(untouched).startsWith("~"), "nothing converted, nothing hedged");
});

test("the mark is added to the text and not to the number behind it", () => {
  // A column that aligns or re-reads the figure must still get the figure.
  const estimate = presentAmount("200", "g", "all-purpose flour", { scale: 1, measurement: "us" });
  assert.ok(!estimate.text.startsWith("~"), "text is the measurement: " + estimate.text);
  assert.ok(!estimate.amount.startsWith("~"), "amount is a number: " + estimate.amount);
  assert.equal(presentedText(estimate), "~" + estimate.text);
});

test("the quantity that started this is not marked, because pounds are exact", () => {
  const shown = presentAmount("1.2", "kg", "strong flour", { scale: 2, measurement: "us" });
  assert.equal(presentedText(shown), shown.text, "no hedge on exact arithmetic: " + shown.text);
});

// ---------------------------------------------------------------------------
// Metric weighs dry goods and pours liquids
// ---------------------------------------------------------------------------

test("a metric recipe weighs the flour and pours the stock", () => {
  // The two halves of the same convention. Both conversions are sound; only
  // one of each pair is a line a recipe would contain.
  const flour = convertIngredient("2", "cup", "plain flour", "metric");
  assert.equal(flour.ok && flour.unit, "g", "250 g flour is an ordinary line");
  assert.equal(flour.ok && flour.approximate, true, "and it rests on how flour packs");

  const stock = convertIngredient("2", "cup", "chicken stock", "metric");
  assert.equal(stock.ok && stock.unit, "ml", "500 ml stock is an ordinary line; 480 g stock is not");
  assert.equal(stock.ok && stock.approximate, false, "and it needed no density");
});

test("the things that are poured are poured, and the things that are spooned are not", () => {
  for (const name of ["water", "whole milk", "double cream", "chicken stock", "olive oil", "red wine"]) {
    const r = convertIngredient("1", "cup", name, "metric");
    assert.equal(r.ok && r.unit, "ml", name + " is poured: " + JSON.stringify(r));
  }
  // Thick, sticky or spooned: a metric recipe gives these in grams, which is
  // easier than scraping a measuring jug and is how they are written.
  for (const name of ["honey", "maple syrup", "greek yogurt", "sour cream", "peanut butter"]) {
    const r = convertIngredient("1", "cup", name, "metric");
    assert.equal(r.ok && r.unit, "g", name + " is weighed: " + JSON.stringify(r));
  }
});

test("pouring in metric does not stop a US recipe asking for a cup of it", () => {
  // The flag is about the metric direction only. US recipes measure stock by
  // the cup, so grams still become cups going the other way.
  const stock = convertIngredient("240", "g", "chicken stock", "us");
  assert.equal(stock.ok && stock.unit, "cup", JSON.stringify(stock));
  assert.equal(stock.ok && stock.approximate, true, "grams to cups went through the density");
});

// ---------------------------------------------------------------------------
// Spoons stop before they become a counting exercise
// ---------------------------------------------------------------------------

test("a US amount is never nine and a half tablespoons", () => {
  // 120 g of caster sugar is about 141 ml: 9 1/2 Tbsp, or 5/8 cup.
  const sugar = us("120", "g", "caster sugar");
  assert.equal(sugar.ok && sugar.unit, "cup", JSON.stringify(sugar));

  // But small amounts stay on the spoon, because the cup fractions down there
  // are not measures either.
  const less = us("80", "g", "caster sugar");
  assert.equal(less.ok && less.unit, "tbsp", "6 1/2 Tbsp beats 3/8 cup: " + JSON.stringify(less));
  const little = convertIngredient("15", "ml", "water", "us");
  assert.equal(little.ok && little.unit, "tbsp");
});
