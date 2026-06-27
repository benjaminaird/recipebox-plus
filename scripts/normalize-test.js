/*
 * Tests for Stage 2 deterministic normalization (no AI). Pure, offline.
 */
const assert = require("assert");
const N = require("../public/recipe-normalize");

// ── Fractions: unicode + smashed mixed numbers ──
assert.strictEqual(N.normalizeFractions("1½ cups"), "1 1/2 cups");
assert.strictEqual(N.normalizeFractions("¾ tsp"), "3/4 tsp");
assert.strictEqual(N.normalizeFractions("11/2 cups"), "1 1/2 cups", "smashed 11/2 -> 1 1/2");
assert.strictEqual(N.normalizeFractions("1/2 cup"), "1/2 cup", "real simple fractions untouched");

// ── Typos: only unambiguous fixes, preserving capitalization ──
assert.strictEqual(N.fixTypos("mix togehter"), "mix together");
assert.strictEqual(N.fixTypos("Occassionally stir"), "Occasionally stir");
assert.strictEqual(N.fixTypos("Seperate the eggs"), "Separate the eggs");
assert.strictEqual(N.fixTypos("the kitchen"), "the kitchen", "real words untouched");

// ── normalizeText: spacing, punctuation, doubled words, sentence option ──
assert.strictEqual(N.normalizeText("pour  the the mixture"), "pour the mixture", "doubled word + double space");
assert.strictEqual(N.normalizeText("add salt ,then stir"), "add salt, then stir", "punctuation spacing");
assert.strictEqual(N.normalizeText("bake until done", { sentence: true }), "Bake until done.", "sentence-cased + period");
assert.strictEqual(N.normalizeText("Stir well.", { sentence: true }), "Stir well.", "already fine");
assert.strictEqual(N.normalizeText("add 2 2 cups"), "add 2 2 cups", "repeated numbers are NOT collapsed");

// ── normalizeRecipe: formatting only; quantities/order/structure preserved ──
const recipe = {
  title: "  grandma's  cookies ",
  description: "mix togehter and bake",
  sections: [{
    name: "main",
    ingredients: [
      { id: "i1", amount: "1½", unit: "tablespoons", name: "  butter " },
      { id: "i2", amount: "2", unit: "teaspoon", name: "vanilla" },
      { id: "i3", amount: "1", unit: "cups", name: "flour" },
    ],
    steps: [{ id: "s1", text: "cream the the butter" }, { id: "s2", text: "Bake at 350°F" }],
  }],
};
const out = N.normalizeRecipe(recipe);
assert.strictEqual(out.title, "grandma's cookies", "title trimmed + spaces collapsed (case left to the source — never re-cased)");
assert.strictEqual(out.description, "mix together and bake", "typo fixed in description");
assert.strictEqual(out.sections[0].name, "main");
assert.deepStrictEqual(out.sections[0].ingredients.map((i) => i.unit), ["Tbsp", "tsp", "cup"], "units standardized in data");
assert.strictEqual(out.sections[0].ingredients[0].amount, "1 1/2", "smashed/unicode fraction fixed; quantity preserved");
assert.strictEqual(out.sections[0].ingredients[0].name, "butter", "ingredient name trimmed, not changed");
assert.strictEqual(out.sections[0].ingredients.length, 3, "ingredient count preserved");
assert.strictEqual(out.sections[0].steps[0].text, "Cream the butter.", "step: doubled word fixed, sentence-cased");
// Input not mutated.
assert.strictEqual(recipe.title, "  grandma's  cookies ", "input recipe is not mutated");
assert.strictEqual(recipe.sections[0].ingredients[0].unit, "tablespoons");

// ── Temperature display conversion (mode-aware, display-only) ──
assert.strictEqual(N.convertTempsInText("Bake at 350°F for 20 minutes", "metric"), "Bake at 175°C for 20 minutes");
assert.strictEqual(N.convertTempsInText("Bake at 175°C", "us"), "Bake at 350°F", "175C -> 350F (rounded)");
assert.strictEqual(N.convertTempsInText("Bake at 350°F", "us"), "Bake at 350°F", "already US -> unchanged");
assert.strictEqual(N.convertTempsInText("Cook 20 minutes", "metric"), "Cook 20 minutes", "plain numbers never touched");
assert.strictEqual(N.convertTempsInText("preheat to 400 degrees F", "metric"), "preheat to 205°C", "'degrees F' handled");

// ── Audit (deterministic warnings) ──
const audit = N.auditRecipe({
  title: "Test", sections: [{ ingredients: [{ name: "flour", unit: "cup" }, { name: "milk", unit: "ml" }], steps: [{ text: "mix togehter and bake at 350°F" }] }],
}, "us");
assert.ok(audit.flags.typos, "audit flags the typo");
assert.ok(audit.flags.mixedUnits, "audit flags mixed US/metric units");
assert.strictEqual(audit.needsCleanup, true, "typo -> cleanup warranted");
assert.ok(audit.warnings.length >= 1);

const cleanAudit = N.auditRecipe({ title: "Clean", sections: [{ ingredients: [{ name: "flour", unit: "cup" }], steps: [{ text: "Mix and bake." }] }] }, "us");
assert.strictEqual(cleanAudit.needsCleanup, false, "a clean recipe needs no cleanup");

// ── Stage 3 gate: detect a direction missing an amount the recipe defines ──
const mq = N.missingDirectionQuantities({
  sections: [{
    ingredients: [{ id: "i1", amount: "2", unit: "Tbsp", name: "water" }, { id: "i2", amount: "1", unit: "cup", name: "flour" }],
    steps: [{ text: "Add water." }, { text: "Stir in {i2}." }, { text: "Bake 20 min." }],
  }],
});
assert.strictEqual(mq.length, 1, "only the quantity-less 'Add water' step is flagged");
assert.strictEqual(mq[0].ingredient, "water");
// A step that already has a number, or uses a chip, isn't flagged.
const noMq = N.missingDirectionQuantities({ sections: [{ ingredients: [{ amount: "2", unit: "Tbsp", name: "water" }], steps: [{ text: "Add 2 Tbsp water." }] }] });
assert.strictEqual(noMq.length, 0);

// ── Stage 3 safety guard: cleanup may change ONLY text ──
const original = {
  sections: [{ ingredients: [{ amount: "2", unit: "Tbsp", name: "water" }, { amount: "1", unit: "cup", name: "flour" }],
               steps: [{ text: "Add water." }, { text: "Mix." }] }],
};
const goodCleanup = { sections: [{ ingredients: [{ amount: "2", unit: "Tbsp", name: "water" }, { amount: "1", unit: "cup", name: "flour" }],
               steps: [{ text: "Add 2 Tbsp water." }, { text: "Mix." }] }] };
assert.strictEqual(N.cleanupPreservedRecipe(original, goodCleanup), true, "fixing only step text is accepted");
const changedQty = { sections: [{ ingredients: [{ amount: "3", unit: "Tbsp", name: "water" }, { amount: "1", unit: "cup", name: "flour" }], steps: [{ text: "Add water." }, { text: "Mix." }] }] };
assert.strictEqual(N.cleanupPreservedRecipe(original, changedQty), false, "changing a quantity is REJECTED");
const addedIng = { sections: [{ ingredients: [{ amount: "2", unit: "Tbsp", name: "water" }, { amount: "1", unit: "cup", name: "flour" }, { amount: "1", unit: "tsp", name: "salt" }], steps: [{ text: "Add water." }, { text: "Mix." }] }] };
assert.strictEqual(N.cleanupPreservedRecipe(original, addedIng), false, "adding an ingredient is REJECTED");
const droppedStep = { sections: [{ ingredients: original.sections[0].ingredients, steps: [{ text: "Add water." }] }] };
assert.strictEqual(N.cleanupPreservedRecipe(original, droppedStep), false, "dropping a step is REJECTED");

console.log("normalize-test: ok");
