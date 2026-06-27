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

// ── Safe weight/volume conversion (US): weight-to-weight + volume-to-volume ──
assert.deepStrictEqual(N.gramsToUsWeight(400), { amount: "14", unit: "oz" }, "400 g -> 14 oz");
assert.deepStrictEqual(N.gramsToUsWeight(85), { amount: "3", unit: "oz" }, "85 g -> 3 oz");
assert.deepStrictEqual(N.gramsToUsWeight(150), { amount: "5", unit: "oz" }, "150 g -> 5 oz");
assert.deepStrictEqual(N.gramsToUsWeight(500), { amount: "1", unit: "lb" }, "500 g -> ~1 lb");
assert.deepStrictEqual(N.mlToUsVolume(240), { amount: "1", unit: "cup" }, "240 ml -> 1 cup");
assert.strictEqual(N.mlToUsVolume(15).unit, "Tbsp", "15 ml -> Tbsp");

// ── Direction conversion in free text (weights, temps), mode-aware ──
assert.strictEqual(
  N.localizeText("Add your 400 g raspberries to a food processor.", "us"),
  "Add your 14 oz raspberries to a food processor.",
  "direction weight conversion (400 g -> 14 oz)");
assert.strictEqual(N.localizeText("Bake at 150°C until set.", "us"), "Bake at 300°F until set.", "direction temp 150C -> 300F");
assert.strictEqual(N.convertMeasuresInText("Cook 20 minutes", "us"), "Cook 20 minutes", "plain numbers untouched");
assert.strictEqual(N.localizeText("Add 2 cups flour.", "metric"), "Add 480 ml flour.", "metric mode converts US volume in text");

// ── Ingredient-specific localization (US), conservative + case-preserving ──
assert.strictEqual(N.localizeIngredientName("corn flour", "us"), "cornstarch");
assert.strictEqual(N.localizeIngredientName("Corn flour", "us"), "Cornstarch", "leading capital preserved");
assert.strictEqual(N.localizeIngredientName("icing sugar", "us"), "powdered sugar");
assert.strictEqual(N.localizeIngredientName("caster sugar", "us"), "superfine sugar");
assert.strictEqual(N.localizeIngredientName("courgette", "us"), "zucchini");
assert.strictEqual(N.localizeIngredientName("aubergine", "us"), "eggplant");
assert.strictEqual(N.localizeIngredientName("corn flour", "metric"), "corn flour", "metric mode leaves terms as written");
assert.strictEqual(N.localizeText("Whisk the corn flour and water together.", "us"), "Whisk the cornstarch and water together.", "term localized in directions");

// ── Duplicate detection: ROW vs ROW only, never vs directions ──
const noDup = N.duplicateIngredientRows({
  sections: [{ ingredients: [{ amount: "400", unit: "g", name: "raspberries" }], steps: [{ text: "Add 400 g raspberries." }] }],
});
assert.deepStrictEqual(noDup, [], "ingredient appearing in directions is NOT a duplicate");
const compoundNoDup = N.duplicateIngredientRows({ sections: [{ ingredients: [{ amount: "1/3", unit: "cup", name: "sugar" }, { amount: "3", unit: "Tbsp", name: "sugar" }] }] });
assert.deepStrictEqual(compoundNoDup, [], "same name, different measure (compound) is NOT a duplicate");
const crossSection = N.duplicateIngredientRows({ sections: [{ ingredients: [{ amount: "1", unit: "cup", name: "sugar" }] }, { ingredients: [{ amount: "1", unit: "cup", name: "sugar" }] }] });
assert.deepStrictEqual(crossSection, [], "same ingredient reused across sections is NOT a duplicate");
const trueDup = N.duplicateIngredientRows({ sections: [{ ingredients: [{ amount: "1", unit: "cup", name: "sugar" }, { amount: "1", unit: "cup", name: "sugar" }] }] });
assert.deepStrictEqual(trueDup, ["sugar"], "identical row twice in one section IS a duplicate");

// ── PDF/app consistency: the ingredient card path (gramsToUsWeight) and the
//    direction-text path (convertMeasuresInText) must agree on the same value ──
const cardOz = N.gramsToUsWeight(400);
const dirText = N.convertMeasuresInText("400 g raspberries", "us");
assert.strictEqual(dirText, cardOz.amount + " " + cardOz.unit + " raspberries", "card and direction text convert identically");

// ── Quality score: bands + useful (not noisy) ──
const cleanQ = N.qualityScore({ title: "Clean", sections: [{ ingredients: [{ amount: "1", unit: "cup", name: "flour" }], steps: [{ text: "Mix and bake." }] }] }, { system: "us" });
assert.strictEqual(cleanQ.band, "Excellent", "a clean recipe scores Excellent");
assert.strictEqual(cleanQ.needsReview, false);
const dupQ = N.qualityScore({ sections: [{ ingredients: [{ amount: "1", unit: "cup", name: "sugar" }, { amount: "1", unit: "cup", name: "sugar" }] }] }, { system: "us" });
assert.ok(dupQ.score < cleanQ.score, "a true duplicate lowers the score");
const groundedQ = N.qualityScore({ sections: [{ ingredients: [{ name: "flour" }] }] }, { system: "us", grounding: { checkable: true, coverage: 0.4 } });
assert.ok(groundedQ.band === "Needs Review" || groundedQ.band === "Poor", "low grounding -> needs review");

// ── Baked Alaska Brownies fixture (from the real imported recipe) ──
const brownies = {
  title: "Baked Alaska Brownies",
  notes: "Chill the assembled brownies at 4°C before serving.",
  sections: [{
    name: "Brownies",
    ingredients: [
      { id: "i1", amount: "400", unit: "g", name: "raspberries" },
      { id: "i2", amount: "85", unit: "g", name: "dark chocolate" },
      { id: "i3", amount: "150", unit: "g", name: "egg whites" },
      { id: "i4", amount: "2", unit: "Tbsp", name: "corn flour" },
    ],
    steps: [
      { id: "s1", text: "add your 400 g raspberries to a food processor and blend togehter" },
      { id: "s2", text: "whisk the corn flour into the egg whites" },
      { id: "s3", text: "bake at 150°C until set" },
    ],
  }],
};
const bn = N.normalizeRecipe(brownies);
// Stage 2 (deterministic) fixed the typo + sentence-cased; units convert at display.
assert.strictEqual(bn.sections[0].steps[0].text, "Add your 400 g raspberries to a food processor and blend together.", "typo togehter -> together, sentence-cased");
// Display-time (US) conversions in directions:
assert.strictEqual(N.localizeText(bn.sections[0].steps[0].text, "us"), "Add your 14 oz raspberries to a food processor and blend together.");
assert.strictEqual(N.localizeText(bn.sections[0].steps[1].text, "us"), "Whisk the cornstarch into the egg whites.");
assert.strictEqual(N.localizeText(bn.sections[0].steps[2].text, "us"), "Bake at 300°F until set.");
// Ingredient weights convert (card path):
assert.deepStrictEqual(N.gramsToUsWeight(400), { amount: "14", unit: "oz" });
assert.deepStrictEqual(N.gramsToUsWeight(85), { amount: "3", unit: "oz" });
assert.deepStrictEqual(N.gramsToUsWeight(150), { amount: "5", unit: "oz" });
// No false duplicate warning, even though raspberries are in both ingredients and directions.
const bAudit = N.auditRecipe(bn, "us");
assert.ok(!bAudit.flags.duplicateRows, "no duplicate flag for the brownies");
assert.ok(!bAudit.warnings.some((w) => /duplicate/i.test(w)), "no duplicate warning for the brownies");
// Notes temperature converts too.
assert.strictEqual(N.localizeText(bn.notes, "us"), "Chill the assembled brownies at 40°F before serving.");

console.log("normalize-test: ok");
