const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { enrichRecipeIngredients } = require("../public/shopping-list");

// 1) The import normalizer must NOT change ingredient identity (the bug was
//    half-and-half showing up as whole milk). Identity-sensitive dairy/flour/etc.
//    must survive enrichment unchanged.
const recipe = { sections: [{ name: "Base", ingredients: [
  { amount: "2", unit: "cups", name: "half-and-half" },
  { amount: "1", unit: "cup", name: "heavy cream" },
  { amount: "1", unit: "cup", name: "buttermilk" },
  { amount: "1", unit: "cup", name: "cake flour" },
] }] };
const names = enrichRecipeIngredients(recipe).sections[0].ingredients.map((i) => i.name);
["half-and-half", "heavy cream", "buttermilk", "cake flour"].forEach((expected) => {
  assert.ok(names.includes(expected), expected + " must be preserved, got: " + JSON.stringify(names));
});
names.forEach((n) => assert.ok(!/^\s*(whole\s+)?milk\s*$/i.test(n), "no ingredient may be normalized to milk: " + n));

// 2) The extraction prompts must explicitly forbid ingredient substitution.
const src = fs.readFileSync(path.join(__dirname, "..", "src", "app.jsx"), "utf8");
assert.ok(/Ingredient fidelity/i.test(src), "system prompt includes an Ingredient fidelity rule");
assert.ok(/half-and-half/i.test(src), "prompt names half-and-half explicitly");
assert.ok(/do\s*not\s*substitut/i.test(src) || /never substitute/i.test(src), "prompt forbids substitution");
assert.ok(/never substitute or simplify an ingredient/i.test(src), "YouTube/social prompts forbid substitution");

// 3) Extraction calls must run at temperature 0 (literal, not paraphrasing).
assert.ok(/EXTRACT_PROMPT, \d+, 0\)/.test(src) || /EXTRACT_PROMPT, ctx\.maxTokens, 0\)/.test(src), "extraction calls pass temperature 0");

// 4) The distinctive-ingredient source-vs-recipe safety net exists.
assert.ok(/findSourceIngredientMismatches/.test(src), "source/recipe ingredient mismatch check exists");
assert.ok(/HIGH_SIGNAL_INGREDIENTS/.test(src) && /half and half/i.test(src), "high-signal ingredient list includes half-and-half");

// 5) Behavioral: pull the real HIGH_SIGNAL list, equivalence groups, and
//    findSourceIngredientMismatches out of app.jsx and execute them so the
//    substitution safety net is tested, not just present.
(function testMismatchBehavior() {
  const grab = (re, label) => { const m = src.match(re); assert.ok(m, "could not extract " + label); return m[1]; };
  const highSignal = grab(/const HIGH_SIGNAL_INGREDIENTS = (\[[\s\S]*?\]);/, "HIGH_SIGNAL_INGREDIENTS");
  const equivalents = grab(/const INGREDIENT_EQUIVALENTS = (\[[\s\S]*?\]);/, "INGREDIENT_EQUIVALENTS");
  const fnBody = grab(/(function findSourceIngredientMismatches\(sourceText, recipe\) \{[\s\S]*?\n {4}\})/, "findSourceIngredientMismatches");
  // eslint-disable-next-line no-new-func
  const make = new Function(
    "return (function(){ const HIGH_SIGNAL_INGREDIENTS = " + highSignal + "; const INGREDIENT_EQUIVALENTS = " + equivalents + "; " + fnBody + " return findSourceIngredientMismatches; })()"
  );
  const findSourceIngredientMismatches = make();
  const rcp = (n) => ({ sections: [{ ingredients: n.map((name) => ({ name })) }] });

  // Real substitution must still be caught: source says half-and-half, recipe has milk.
  let f = findSourceIngredientMismatches("Use 2 cups half-and-half and a pinch of salt.", rcp(["whole milk", "salt"]));
  assert.ok(f.includes("half-and-half"), "half-and-half dropped for milk must flag, got: " + JSON.stringify(f));

  // buttermilk -> milk must flag.
  f = findSourceIngredientMismatches("1 cup buttermilk, well shaken.", rcp(["milk"]));
  assert.ok(f.includes("buttermilk"), "buttermilk dropped must flag, got: " + JSON.stringify(f));

  // Same-product synonyms must NOT flag: source 'heavy whipping cream', recipe 'heavy cream'.
  f = findSourceIngredientMismatches("Beat the heavy whipping cream until stiff.", rcp(["heavy cream", "sugar"]));
  assert.deepStrictEqual(f, [], "heavy cream == heavy whipping cream must not flag, got: " + JSON.stringify(f));

  // And the reverse direction.
  f = findSourceIngredientMismatches("Whip the heavy cream.", rcp(["heavy whipping cream"]));
  assert.deepStrictEqual(f, [], "heavy whipping cream == heavy cream must not flag, got: " + JSON.stringify(f));

  // powdered/confectioners sugar synonym must not flag.
  f = findSourceIngredientMismatches("Dust with confectioners sugar.", rcp(["powdered sugar"]));
  assert.deepStrictEqual(f, [], "confectioners == powdered sugar must not flag, got: " + JSON.stringify(f));
})();

console.log("import-fidelity-test: ok");
