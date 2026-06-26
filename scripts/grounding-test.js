/*
 * Tests for the import grounding/verification pass (Phase 3). Pure, offline.
 */
const assert = require("assert");
const G = require("../public/recipe-grounding");

function recipe(names) {
  return { sections: [{ name: "Main", ingredients: names.map((n, i) => ({ id: "i" + i, name: n })) }] };
}

const source =
  "Ingredients: 2 cups all-purpose flour, 1 cup heavy cream, 3 cloves garlic, " +
  "1 teaspoon smoked paprika, half-and-half, 2 large eggs, fresh basil, salt and pepper. " +
  "Whisk the eggs, add the flour, fold in the cream and basil.";

// ── contentTokens: drop units/prep/fillers and numbers ──
assert.deepStrictEqual(G.contentTokens("2 cups all-purpose flour"), ["all", "purpose", "flour"]);
assert.deepStrictEqual(G.contentTokens("1 teaspoon salt"), ["salt"]);
assert.deepStrictEqual(G.contentTokens("3 cloves garlic, minced"), ["garlic"]);

// ── isGrounded: present ingredients ground; invented ones don't ──
const src = G.normalize(source);
assert.strictEqual(G.isGrounded("all-purpose flour", src), true, "flour is in the source");
assert.strictEqual(G.isGrounded("heavy cream", src), true);
assert.strictEqual(G.isGrounded("2 large eggs", src), true, "eggs (plural variant) grounds");
assert.strictEqual(G.isGrounded("boneless chicken thighs", src), false, "chicken is NOT in the source -> ungrounded");
assert.strictEqual(G.isGrounded("salt", src), true);

// ── groundRecipe: coverage + ungrounded list ──
const faithful = G.groundRecipe(recipe(["all-purpose flour", "heavy cream", "garlic", "smoked paprika", "eggs", "basil"]), source);
assert.strictEqual(faithful.coverage, 1, "a faithful extraction is fully grounded");
assert.strictEqual(faithful.ungrounded.length, 0);

const hallucinated = G.groundRecipe(recipe(["all-purpose flour", "chicken breast", "soy sauce"]), source);
assert.ok(hallucinated.ungrounded.includes("chicken breast"), "invented chicken flagged");
assert.ok(hallucinated.ungrounded.includes("soy sauce"), "invented soy sauce flagged");
assert.ok(hallucinated.coverage < 0.5, "coverage drops with hallucinations");

// No source text -> not checkable, coverage 1, no false alarms (e.g. photo import).
const noSrc = G.groundRecipe(recipe(["flour", "eggs"]), "");
assert.strictEqual(noSrc.checkable, false);
assert.strictEqual(noSrc.coverage, 1);

// ── droppedDistinctive: source names half-and-half but recipe says milk ──
const dropped = G.droppedDistinctive(recipe(["whole milk", "flour", "eggs"]), source);
assert.ok(dropped.includes("half and half"), "source's half-and-half, missing from recipe, is flagged");
const noDrop = G.droppedDistinctive(recipe(["half and half", "heavy cream"]), source);
assert.ok(!noDrop.includes("half and half"), "present distinctive ingredient is not flagged");

// ── verifyImport: combined verdict ──
const good = G.verifyImport(recipe(["all-purpose flour", "heavy cream", "garlic", "smoked paprika", "eggs", "basil", "half and half"]), source);
assert.strictEqual(good.needsReview, false, "a faithful import needs no review");
assert.strictEqual(good.confidence, 1);
assert.strictEqual(good.warnings.length, 0);

const bad = G.verifyImport(recipe(["flour", "chicken breast", "soy sauce", "fish sauce"]), source);
assert.strictEqual(bad.needsReview, true, "a drifted import is flagged for review");
assert.ok(bad.warnings.length >= 1, "warnings explain why");
assert.ok(bad.ungrounded.length >= 2);

// A single ungrounded synonym ADDED to an otherwise-faithful recipe (nothing
// distinctive dropped) should NOT trip review — lenient: confidence stays high.
const oneOff = G.verifyImport(recipe(["all-purpose flour", "heavy cream", "garlic", "smoked paprika", "eggs", "basil", "half and half", "scallions"]), source);
assert.ok(oneOff.confidence >= 0.85, "one ungrounded item keeps confidence high (" + oneOff.confidence + ")");
assert.strictEqual(oneOff.dropped.length, 0, "nothing distinctive was dropped");
assert.strictEqual(oneOff.needsReview, false, "one extra synonym doesn't force review");

console.log("grounding-test: ok");
