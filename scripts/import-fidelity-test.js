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

console.log("import-fidelity-test: ok");
