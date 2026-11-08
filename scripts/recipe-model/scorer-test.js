#!/usr/bin/env node
"use strict";
// Proves the M1 scorer catches each failure class it claims to measure, using
// hand-built outputs that reproduce reported RecipeBox failures. If the scorer
// can't see a failure, the baseline that relies on it is meaningless.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { score, referenceOutput } = require("./scorer");
const { parseAmount, sameQuantity, writtenFaithfully } = require("./quantity");

const CASES = path.join(__dirname, "..", "..", "tests", "recipe-model", "cases");
const load = (id) => JSON.parse(fs.readFileSync(path.join(CASES, id + ".case.json"), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

// quantities
assert.strictEqual(parseAmount("1 1/2"), 1.5);
assert.strictEqual(parseAmount("½"), 0.5);
assert.strictEqual(parseAmount("1½"), 1.5);
assert.strictEqual(parseAmount("pinch"), null);
assert.ok(sameQuantity("0.5", "cups", "1/2", "cup"));
assert.ok(!sameQuantity("1", "cup", "2", "cups"));
assert.ok(!writtenFaithfully("2.3333332538605", "2 1/3"));
assert.ok(!writtenFaithfully("0.25", "1/4"));
assert.ok(writtenFaithfully("1/4", "1/4"));

// every public case: the ideal output scores full marks
for (const f of fs.readdirSync(CASES).filter((x) => x.endsWith(".case.json"))) {
  const c = JSON.parse(fs.readFileSync(path.join(CASES, f), "utf8"));
  const m = score(c.truth, referenceOutput(c.truth));
  assert.strictEqual(m.ingredients.found, m.ingredients.total, `${c.id}: reference finds all ingredients`);
  if (m.links) assert.strictEqual(m.links.correct, m.links.truthPairs, `${c.id}: reference links`);
  if (m.portions) assert.strictEqual(m.portions.correct, m.portions.total, `${c.id}: reference portions`);
  if (m.preparations) assert.strictEqual(m.preparations.listedAsIngredient, 0, `${c.id}: reference preparations`);
  if (m.contradictions) assert.strictEqual(m.contradictions.surfaced, m.contradictions.total, `${c.id}: reference contradictions`);
  if (m.suppression) assert.strictEqual(m.suppression.invented, 0, `${c.id}: reference suppression`);
  if (m.source) assert.strictEqual(m.source.ok, m.source.total, `${c.id}: reference source`);
}

// pumpkin pudding: "pudding mixture" imported as something to buy
{
  const c = load("pumpkin-pudding");
  const out = referenceOutput(c.truth);
  out.sections[0].ingredients = out.sections[0].ingredients.filter((g) => g.kind !== "preparation");
  out.sections[0].ingredients.push({ id: "x1", amount: "1", unit: "box", name: "pudding mixture" });
  const m = score(c.truth, out);
  assert.strictEqual(m.preparations.listedAsIngredient, 1, "prepared mixture listed as an ingredient is detected");
}

// pumpkin pudding: "3/4 cup sugar, divided" with the full amount on both steps
{
  const c = load("pumpkin-pudding");
  const out = referenceOutput(c.truth);
  for (const s of out.sections[0].steps) s.ingredientRefs = s.ingredientRefs.map((r) => (typeof r === "object" ? r.id : r));
  const m = score(c.truth, out);
  assert.strictEqual(m.portions.correct, 0, "split ingredient without portions scores zero portions");
  assert.strictEqual(m.links.correct, m.links.truthPairs, "links can still be right while portions are missing");
}

// pumpkin pudding: servings and macros guessed for a recipe that never states them
{
  const c = load("pumpkin-pudding");
  const out = referenceOutput(c.truth);
  out.servings = "6"; out.macros = { calories: 210 };
  assert.strictEqual(score(c.truth, out).suppression.invented, 2, "guessed servings and macros are detected");
}

// chocolate ice cream: custard base treated as an ingredient, cream portions wrong
{
  const c = load("chocolate-ice-cream");
  const out = referenceOutput(c.truth);
  out.sections[0].ingredients = out.sections[0].ingredients.filter((g) => g.kind !== "preparation");
  out.sections[0].ingredients.push({ id: "x2", amount: "", unit: "", name: "chilled custard base" });
  const step1 = out.sections.flatMap((s) => s.steps).find((s) => /put the chocolate/.test(s.text));
  step1.ingredientRefs = step1.ingredientRefs.map((r) => (typeof r === "object" ? { ...r, amount: "2" } : r));
  const m = score(c.truth, out);
  assert.ok(m.preparations.listedAsIngredient >= 1, "custard base as an ingredient is detected");
  assert.ok(m.portions.correct < m.portions.total, "full cream amount on a split step is detected");
}

// incorrect ingredient-to-step reference
{
  const c = load("flour-contradiction");
  const out = referenceOutput(c.truth);
  const steps = out.sections[0].steps;
  steps[0].ingredientRefs.push(steps[1].ingredientRefs[0]); // flour wrongly added to the creaming step
  const m = score(c.truth, out);
  assert.ok(m.links.precision < 1, "a wrong reference lowers precision");
  assert.strictEqual(m.links.recall, 1, "recall is unaffected by an extra wrong link");
}

// contradiction silently resolved
{
  const c = load("flour-contradiction");
  const out = referenceOutput(c.truth);
  out.flags = [];
  out.sections[0].ingredients.find((g) => /flour/.test(g.name)).amount = "2";
  const m = score(c.truth, out);
  assert.strictEqual(m.contradictions.silentlyResolved, 1, "picking one number without a flag is detected");
}

// ingredient-section confusion (filling ingredients filed under the crust)
{
  const c = load("lemon-tart-sections");
  const out = referenceOutput(c.truth);
  out.sections[0].ingredients.push(...out.sections[1].ingredients.splice(0));
  const m = score(c.truth, out);
  assert.strictEqual(m.sections.correct, 3, "filling ingredients in the crust section are detected");
}

// missing quantities must not be invented; unreadable ones must be flagged
{
  const c = load("ambiguous-quantities");
  const out = referenceOutput(c.truth);
  out.sections[0].ingredients.find((g) => /egg/.test(g.name)).amount = "4";
  assert.strictEqual(score(c.truth, out).quantities.invented, 1, "an invented egg count is detected");
  const card = load("low-confidence-card");
  const o2 = referenceOutput(card.truth);
  const v = o2.sections[0].ingredients.find((g) => /vanilla/.test(g.name));
  v.amount = "1"; delete v.flag; o2.flags = o2.flags.filter((f) => f.ingredientId !== v.id);
  const m2 = score(card.truth, o2);
  assert.strictEqual(m2.quantities.unreadableFlagged, 0);
  assert.strictEqual(m2.quantities.invented, 1, "a guessed unreadable quantity is detected");
}

// source preservation: tracking parameters left in, author missing
{
  const c = load("source-attribution-blog");
  const out = referenceOutput(c.truth);
  out.source = { url: c.input.url, siteName: "Fixture Food Blog", originalTitle: "Weeknight Lentil Soup" };
  const m = score(c.truth, out);
  assert.strictEqual(m.source.fields.url.ok, false, "uncleaned URL is detected");
  assert.strictEqual(m.source.fields.author.ok, false, "missing author is detected");
  assert.strictEqual(m.source.ok, 2);
}

console.log("recipe-model scorer-test: ok");
