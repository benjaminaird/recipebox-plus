// Units and quantities, plus a parity check against the production web module.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRequire } from "node:module";
import {
  canonicalUnit, convert, displayUnit, unitKind, unitSystem,
  VOLUME_ML, WEIGHT_G,
} from "../src/domain/units.ts";
import {
  formatNumber, formatQuantity, normalizeFractions, parseQuantity,
  roundDiscrete, scaleQuantity,
} from "../src/domain/quantity.ts";

const require_ = createRequire(import.meta.url);
// The real module the production web app loads, not a copy of it.
const web = require_("../../../public/shopping-list.js");

// ---------------------------------------------------------------------------
// Parity. This domain code restates primitives that already exist in
// public/shopping-list.js. That module cannot be edited without changing
// production web behaviour, so the two must be held together by a test rather
// than by good intentions.
// ---------------------------------------------------------------------------

test("fraction parsing agrees with the web module wherever it commits to a number", () => {
  for (const input of ["1", "2", "0.5", "1/2", "3/4", "1 1/2", "2 1/4", "½", "1 ½", "⅔"]) {
    const theirs = web.amountToNumber(input);
    const ours = parseQuantity(input);
    assert.equal(ours.kind, "exact", `${input} should read as a number`);
    assert.ok(
      Math.abs((ours as { value: number }).value - theirs) < 1e-9,
      `${input}: ours ${(ours as { value: number }).value} vs web ${theirs}`,
    );
  }
});

test("fraction formatting agrees with the web module", () => {
  for (const n of [0.125, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1.5, 2.25, 3]) {
    assert.equal(formatNumber(n), web.numberToFraction(n), `formatting ${n}`);
  }
});

test("unit abbreviation agrees with the web module", () => {
  for (const u of ["tablespoons", "teaspoon", "grams", "kilograms", "milliliters", "pounds", "ounces"]) {
    assert.equal(displayUnit(u), web.abbreviateUnit(u, 2), `abbreviating ${u}`);
  }
});

test("the web module's two gaps are the reason this module exists", () => {
  // Ranges: it returns null, so a range could never be scaled.
  assert.equal(web.amountToNumber("1-2"), null);
  assert.deepEqual(parseQuantity("1-2"), { kind: "range", min: 1, max: 2 });

  // Metric volume: displayable there, not convertible.
  assert.equal(web.abbreviateUnit("milliliters", 2), "ml");
  assert.ok(convert(1000, "ml", "L") === 1, "this module converts metric volume");
});

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

test("units are canonicalised to a singular, lower-case form", () => {
  assert.equal(canonicalUnit("Tablespoons."), "tbsp");
  assert.equal(canonicalUnit("  GRAMS "), "g");
  assert.equal(canonicalUnit("Litres"), "L");
  assert.equal(canonicalUnit("cloves"), "clove");
  assert.equal(canonicalUnit("pinches"), "pinch");
  assert.equal(canonicalUnit(""), "");
  assert.equal(canonicalUnit(undefined), "");
});

test("a unit knows what kind of thing it measures", () => {
  assert.equal(unitKind("cups"), "volume");
  assert.equal(unitKind("ml"), "volume");
  assert.equal(unitKind("kg"), "weight");
  assert.equal(unitKind("eggs"), "count");
  assert.equal(unitKind("a pinch".replace("a ", "")), "descriptive");
  assert.equal(unitKind("sprinkle"), "unknown");
});

test("a unit knows which system it belongs to", () => {
  assert.equal(unitSystem("cup"), "us");
  assert.equal(unitSystem("lb"), "us");
  assert.equal(unitSystem("ml"), "metric");
  assert.equal(unitSystem("g"), "metric");
  assert.equal(unitSystem("clove"), "neutral", "counted things belong to neither system");
  assert.equal(unitSystem("pinch"), "neutral");
});

test("conversion within a kind is exact enough for a kitchen", () => {
  assert.ok(Math.abs(convert(1, "cup", "ml")! - 236.588) < 0.001);
  assert.ok(Math.abs(convert(3, "tsp", "tbsp")! - 1) < 1e-9);
  assert.ok(Math.abs(convert(1, "kg", "lb")! - 2.20462) < 0.0001);
  assert.equal(convert(2, "cup", "cup"), 2);
});

test("volume and weight do not convert without an ingredient", () => {
  // The requirement in one assertion: cups and grams are not interchangeable.
  assert.equal(convert(1, "cup", "g"), null);
  assert.equal(convert(100, "g", "ml"), null);
  assert.equal(convert(1, "egg", "g"), null);
});

test("every unit in a table is reachable through canonicalUnit", () => {
  for (const u of [...Object.keys(VOLUME_ML), ...Object.keys(WEIGHT_G)]) {
    assert.equal(canonicalUnit(u), u, `${u} should be its own canonical form`);
  }
});

test("counted units take a plural only when there is more than one", () => {
  assert.equal(displayUnit("clove", 1), "clove");
  assert.equal(displayUnit("clove", 3), "cloves");
  assert.equal(displayUnit("pinch", 2), "pinches");
  assert.equal(displayUnit("g", 5), "g", "measurement units are not pluralised");
});

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

test("vulgar fractions become mixed numbers, not concatenated digits", () => {
  assert.equal(normalizeFractions("1 ½"), "1 1/2");
  assert.equal(normalizeFractions("1½"), "1 1/2", "the glyph implies the space");
  assert.equal(normalizeFractions("½"), "1/2");
});

test("an amount reads as exactly one of four things", () => {
  assert.deepEqual(parseQuantity("2"), { kind: "exact", value: 2 });
  assert.deepEqual(parseQuantity("1 1/2"), { kind: "exact", value: 1.5 });
  assert.deepEqual(parseQuantity("1-2"), { kind: "range", min: 1, max: 2 });
  assert.deepEqual(parseQuantity("2 to 3"), { kind: "range", min: 2, max: 3 });
  assert.deepEqual(parseQuantity("a pinch"), { kind: "opaque", text: "a pinch" });
  assert.deepEqual(parseQuantity(""), { kind: "none" });
  assert.deepEqual(parseQuantity(undefined), { kind: "none" });
});

test("a hyphen inside a word is not a range", () => {
  assert.equal(parseQuantity("half-and-half").kind, "opaque");
});

test("a reversed range is read in order", () => {
  assert.deepEqual(parseQuantity("3-1"), { kind: "range", min: 1, max: 3 });
});

test("scaling multiplies numbers and leaves words alone", () => {
  assert.deepEqual(scaleQuantity(parseQuantity("2"), 3), { kind: "exact", value: 6 });
  assert.deepEqual(scaleQuantity(parseQuantity("1-2"), 2), { kind: "range", min: 2, max: 4 });
  // The honest case: "a pinch" times three is not "three pinches".
  assert.deepEqual(scaleQuantity(parseQuantity("a pinch"), 3), { kind: "opaque", text: "a pinch" });
  assert.deepEqual(scaleQuantity(parseQuantity(""), 3), { kind: "none" });
});

test("scaling by a half gives fractions a cook can measure", () => {
  assert.equal(formatQuantity(scaleQuantity(parseQuantity("1"), 0.5)), "1/2");
  assert.equal(formatQuantity(scaleQuantity(parseQuantity("3/4"), 0.5)), "3/8");
  assert.equal(formatQuantity(scaleQuantity(parseQuantity("1 1/2"), 2)), "3");
});

test("floating point never reaches the interface", () => {
  // 0.1 + 0.2 arithmetic must not surface as 0.30000000000000004.
  assert.equal(formatNumber(0.1 + 0.2), "0.3");
  assert.equal(formatNumber(1 / 3), "1/3");
  assert.equal(formatNumber(2 / 3), "2/3");
  assert.equal(formatNumber(0.3333333333333333 * 3), "1");
  for (const n of [0.07, 1.01, 7.77, 123.456]) {
    assert.ok(!formatNumber(n).includes("000"), `${n} -> ${formatNumber(n)}`);
    assert.ok(formatNumber(n).length < 8, `${n} -> ${formatNumber(n)}`);
  }
});

test("large amounts are not written in eighths", () => {
  assert.equal(formatNumber(12.5), "12.5");
  assert.equal(formatNumber(100), "100");
});

test("discrete items round to whole things, and never to none", () => {
  assert.deepEqual(roundDiscrete({ kind: "exact", value: 1.5 }), { kind: "exact", value: 2 });
  assert.deepEqual(roundDiscrete({ kind: "exact", value: 0.5 }), { kind: "exact", value: 1 });
  // Halving a single egg still needs an egg.
  assert.deepEqual(roundDiscrete({ kind: "exact", value: 0.25 }), { kind: "exact", value: 1 });
  assert.deepEqual(roundDiscrete({ kind: "range", min: 1.4, max: 2.6 }), { kind: "range", min: 1, max: 3 });
  assert.deepEqual(roundDiscrete({ kind: "opaque", text: "a few" }), { kind: "opaque", text: "a few" });
});
