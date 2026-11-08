#!/usr/bin/env node
"use strict";
// Proves the M1 scorer catches each failure class it claims to measure, and
// files it under the right class: detection (missed or unexpressed) versus
// modification (the recipe itself was changed). Uses hand-built outputs that
// reproduce reported RecipeBox failures. If the scorer can't see a failure, the
// baseline that relies on it is meaningless.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { score, referenceOutput } = require("./scorer");
const { parseAmount, sameQuantity, writtenFaithfully } = require("./quantity");

const CASES = path.join(__dirname, "..", "..", "tests", "recipe-model", "cases");
const load = (id) => JSON.parse(fs.readFileSync(path.join(CASES, id + ".case.json"), "utf8"));
const ingByName = (out, re) => out.sections.flatMap((s) => s.ingredients).find((g) => re.test(g.name));
const stepByText = (out, re) => out.sections.flatMap((s) => s.steps).find((s) => re.test(s.text));
const D = (m) => m.classes.detection;
const M = (m) => m.classes.modification;
let n = 0;
const test = (name, fn) => { fn(); n++; void name; };

test("quantity helpers", () => {
  assert.strictEqual(parseAmount("1 1/2"), 1.5);
  assert.strictEqual(parseAmount("½"), 0.5);
  assert.strictEqual(parseAmount("1½"), 1.5);
  assert.strictEqual(parseAmount("pinch"), null);
  assert.ok(sameQuantity("0.5", "cups", "1/2", "cup"));
  assert.ok(!sameQuantity("1", "cup", "2", "cups"));
  assert.ok(!writtenFaithfully("2.3333332538605", "2 1/3"));
  assert.ok(!writtenFaithfully("0.25", "1/4"));
  assert.ok(writtenFaithfully("1/4", "1/4"));
});

test("every public case: the ideal output has no findings at all", () => {
  for (const f of fs.readdirSync(CASES).filter((x) => x.endsWith(".case.json"))) {
    const c = JSON.parse(fs.readFileSync(path.join(CASES, f), "utf8"));
    const m = score(c.truth, referenceOutput(c.truth));
    assert.deepStrictEqual(m.classes, { detection: {}, modification: {} }, `${c.id}: reference output has findings ${JSON.stringify(m.classes)}`);
  }
});

test("pumpkin pudding: prepared mixture imported as a purchase is a detection failure", () => {
  const c = load("pumpkin-pudding");
  const out = referenceOutput(c.truth);
  out.sections[0].ingredients = out.sections[0].ingredients.filter((g) => g.kind !== "preparation");
  out.sections[0].ingredients.push({ id: "x1", amount: "1", unit: "box", name: "pudding mixture" });
  const m = score(c.truth, out);
  assert.strictEqual(D(m).preparationsListedAsIngredients, 1);
  assert.strictEqual(M(m).ingredientsInvented, undefined, "a misclassified preparation is not also counted as invented");
});

test("pumpkin pudding: divided sugar shown in full on both steps → portions missing (detection)", () => {
  const c = load("pumpkin-pudding");
  const out = referenceOutput(c.truth);
  for (const s of out.sections[0].steps) s.ingredientRefs = s.ingredientRefs.map((r) => (typeof r === "object" ? r.id : r));
  const m = score(c.truth, out);
  assert.strictEqual(D(m).portionsMissing, 2);
  assert.strictEqual(D(m).linksMissing, undefined, "links themselves are still right");
  assert.deepStrictEqual(M(m), {});
});

test("pumpkin pudding: guessed servings and macros are modifications", () => {
  const c = load("pumpkin-pudding");
  const out = referenceOutput(c.truth);
  out.servings = "6"; out.macros = { calories: 210 };
  assert.strictEqual(M(score(c.truth, out)).fieldsInvented, 2);
});

test("chocolate ice cream: custard base as an ingredient, wrong cream portion", () => {
  const c = load("chocolate-ice-cream");
  const out = referenceOutput(c.truth);
  out.sections[0].ingredients = out.sections[0].ingredients.filter((g) => g.kind !== "preparation");
  out.sections[0].ingredients.push({ id: "x2", amount: "", unit: "", name: "chilled custard base" });
  const s1 = stepByText(out, /put the chocolate/);
  s1.ingredientRefs = s1.ingredientRefs.map((r) => (typeof r === "object" ? { ...r, amount: "2" } : r));
  const m = score(c.truth, out);
  assert.ok(D(m).preparationsListedAsIngredients >= 1);
  assert.strictEqual(D(m).portionsMissing, 1);
});

test("an extra wrong ingredient-to-step link is a detection failure, precision drops", () => {
  const c = load("flour-contradiction");
  const out = referenceOutput(c.truth);
  const st = out.sections[0].steps;
  st[0].ingredientRefs.push(st[1].ingredientRefs[0]);
  const m = score(c.truth, out);
  assert.strictEqual(D(m).linksWrong, 1);
  assert.ok(m.links.precision < 1 && m.links.recall === 1);
});

test("a reference to an ingredient that does not exist is a modification", () => {
  const c = load("flour-contradiction");
  const out = referenceOutput(c.truth);
  out.sections[0].steps[0].ingredientRefs.push("i99");
  const m = score(c.truth, out);
  assert.strictEqual(M(m).invalidReferences, 1);
  assert.strictEqual(m.links.outputPairs, m.links.correct, "invalid refs are not double-counted as wrong links");
});

test("contradiction: kept as listed but unflagged = detection; settled to the method's number = modification", () => {
  const c = load("flour-contradiction");
  const kept = referenceOutput(c.truth);
  kept.flags = [];
  assert.strictEqual(D(score(c.truth, kept)).contradictionsNotFlagged, 1);
  assert.deepStrictEqual(M(score(c.truth, kept)), {});
  const settled = referenceOutput(c.truth);
  settled.flags = [];
  ingByName(settled, /flour/).amount = "2";
  assert.strictEqual(M(score(c.truth, settled)).contradictionsSettledSilently, 1);
});

test("filling ingredients filed under the crust are a detection failure", () => {
  const c = load("lemon-tart-sections");
  const out = referenceOutput(c.truth);
  out.sections[0].ingredients.push(...out.sections[1].ingredients.splice(0));
  assert.strictEqual(D(score(c.truth, out)).sectionsWrong, 4);
});

test("missing and unreadable quantities: invented is a modification, unflagged blank is a detection failure", () => {
  const c = load("ambiguous-quantities");
  const out = referenceOutput(c.truth);
  ingByName(out, /egg/).amount = "4";
  assert.strictEqual(M(score(c.truth, out)).quantitiesInvented, 1);
  const card = load("low-confidence-card");
  const guessed = referenceOutput(card.truth);
  const v = ingByName(guessed, /vanilla/);
  v.amount = "1"; delete v.flag; guessed.flags = guessed.flags.filter((f) => f.ingredientId !== v.id);
  assert.strictEqual(M(score(card.truth, guessed)).quantitiesInvented, 1);
  const silent = referenceOutput(card.truth);
  const v2 = ingByName(silent, /vanilla/);
  delete v2.flag; silent.flags = silent.flags.filter((f) => f.ingredientId !== v2.id);
  const m = score(card.truth, silent);
  assert.strictEqual(D(m).unreadableNotFlagged, 1);
  assert.strictEqual(M(m).quantitiesInvented, undefined);
});

test("float artefacts and decimal rewrites are modifications of representation", () => {
  const c = load("fraction-fidelity");
  const out = referenceOutput(c.truth);
  ingByName(out, /banana/).amount = "2.3333332538605";
  ingByName(out, /brown sugar/).amount = "0.333";
  const m = score(c.truth, out);
  assert.strictEqual(M(m).floatArtefacts, 2);
  assert.ok(m.quantities.faithful < m.quantities.correct, "numerically equal, but not as written");
});

test("a changed quantity is a modification", () => {
  const c = load("fraction-fidelity");
  const out = referenceOutput(c.truth);
  ingByName(out, /baking soda/).amount = "2";
  assert.strictEqual(M(score(c.truth, out)).quantitiesChanged, 1);
});

test("substitution offered in the notes, applied by the importer: one dropped, one invented", () => {
  const c = load("substitution-in-notes");
  const out = referenceOutput(c.truth);
  ingByName(out, /butter/).name = "margarine";
  const m = score(c.truth, out);
  assert.strictEqual(M(m).ingredientsDropped, 1);
  assert.strictEqual(M(m).ingredientsInvented, 1);
});

test("step wording rewritten (a quantity removed from the instruction) is a modification", () => {
  const c = load("divided-butter-bars");
  const out = referenceOutput(c.truth);
  const s = stepByText(out, /melt 1\/2 cup/);
  s.text = s.text.replace("1 1/2 cups", "the");
  assert.strictEqual(M(score(c.truth, out)).stepWordingChanged, 1);
});

test("source: tracking parameters kept and author missing are detection failures", () => {
  const c = load("source-attribution-blog");
  const out = referenceOutput(c.truth);
  out.source = { url: c.input.url, siteName: "Fixture Food Blog", originalTitle: "Weeknight Lentil Soup" };
  const m = score(c.truth, out);
  assert.strictEqual(m.source.fields.url.ok, false);
  assert.strictEqual(m.source.fields.author.ok, false);
  assert.strictEqual(D(m).sourceFieldsMissing, 2);
  assert.deepStrictEqual(M(m), {});
});

test("inline {id} tokens are read as the cook sees them: rendered names, counted as links", () => {
  const c = load("structured-curry");
  const out = referenceOutput(c.truth);
  const s3 = stepByText(out, /stir in the chickpeas/);
  const chick = ingByName(out, /chickpea/), coco = ingByName(out, /coconut milk/);
  chick.name = "chickpeas, drained";
  s3.text = s3.text.replace("stir in the chickpeas", "stir in the {" + chick.id + "}").replace(/$/, " with {" + coco.id + "}");
  s3.ingredientRefs = [];
  const m = score(c.truth, out);
  assert.deepStrictEqual(m.classes, { detection: {}, modification: {} });
});

test("a token pointing at another section's ingredient is a wrong link", () => {
  const c = load("frosting-headers-in-list");
  const out = referenceOutput(c.truth);
  const f1 = stepByText(out, /beat the cream cheese/);
  const cakeSugar = out.sections[0].ingredients.find((g) => g.name === "sugar");
  f1.text += " {" + cakeSugar.id + "}";
  assert.strictEqual(D(score(c.truth, out)).linksWrong, 1);
});

console.log(`recipe-model scorer-test: ok (${n} tests)`);
