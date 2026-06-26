const assert = require("assert");
const N = require("../public/nutrition");
const app = require("../server");
const { detectAiFeature, aiAssistCost } = app._test;

// ── normalizeNutrition: coerce messy model/import output to a fixed shape ──
const messy = N.normalizeNutrition({
  calories: "350 kcal", protein_g: "12g", carbohydrates: "40", total_fat: 9.25,
  dietary_fiber: "3 g", sugars: "8", sodium_mg: "480mg", junk: "ignore me",
});
assert.deepStrictEqual(messy, { calories: 350, protein: 12, carbs: 40, fat: 9.3, fiber: 3, sugar: 8, sodium: 480 }, "units/aliases coerced, grams rounded to 1 dp");

// Negatives clamp to 0; non-numeric -> null; calories/sodium are integers.
const clamped = N.normalizeNutrition({ calories: -5, protein: "abc", carbs: 12.04, fat: 7.99, sodium: -10 });
assert.strictEqual(clamped.calories, 0, "negative calories clamp to 0");
assert.strictEqual(clamped.protein, null, "non-numeric -> null");
assert.strictEqual(clamped.carbs, 12, "grams round to 1 dp");
assert.strictEqual(clamped.fat, 8, "8.0 rounds cleanly");
assert.strictEqual(clamped.sodium, 0, "negative sodium clamps to 0");

// No usable core macros -> null (so the UI offers an estimate instead).
assert.strictEqual(N.normalizeNutrition({ fiber: 2, sugar: 1 }), null, "fiber/sugar alone isn't usable nutrition");
assert.strictEqual(N.normalizeNutrition(null), null);
assert.strictEqual(N.normalizeNutrition([1, 2, 3]), null, "arrays rejected");

// ── parseNutrition: tolerant of code fences / surrounding prose ──
assert.deepStrictEqual(
  N.parseNutrition('```json\n{"calories":200,"protein":10,"carbs":20,"fat":5}\n```'),
  { calories: 200, protein: 10, carbs: 20, fat: 5, fiber: null, sugar: null, sodium: null },
  "strips code fences and parses",
);
assert.deepStrictEqual(
  N.parseNutrition('Here is the estimate: {"calories":150,"protein":3,"carbs":30,"fat":2}. Enjoy!'),
  { calories: 150, protein: 3, carbs: 30, fat: 2, fiber: null, sugar: null, sodium: null },
  "grabs the JSON object out of prose",
);
assert.strictEqual(N.parseNutrition("sorry, I can't"), null, "no JSON -> null");
assert.strictEqual(N.parseNutrition(null), null);

// ── ingredientsFingerprint: deterministic + sensitive to what changes macros ──
const recipe = {
  title: "Test Soup", servings: 4,
  sections: [{ name: "Main", ingredients: [
    { amount: "2", unit: "cup", name: "broth" },
    { amount: "1", unit: "lb", name: "chicken" },
  ] }],
};
const fp1 = N.ingredientsFingerprint(recipe);
assert.strictEqual(typeof fp1, "string");
// Ingredient order doesn't matter (sorted), so the fingerprint is stable.
const reordered = { ...recipe, sections: [{ name: "Main", ingredients: [
  { amount: "1", unit: "lb", name: "chicken" },
  { amount: "2", unit: "cup", name: "broth" },
] }] };
assert.strictEqual(N.ingredientsFingerprint(reordered), fp1, "ingredient order doesn't change the fingerprint");
// Changing an amount, an ingredient, or the servings DOES change it.
assert.notStrictEqual(N.ingredientsFingerprint({ ...recipe, servings: 8 }), fp1, "servings change -> new fingerprint");
const changed = { ...recipe, sections: [{ name: "Main", ingredients: [
  { amount: "3", unit: "cup", name: "broth" },
  { amount: "1", unit: "lb", name: "chicken" },
] }] };
assert.notStrictEqual(N.ingredientsFingerprint(changed), fp1, "amount change -> new fingerprint");

// ── isStale / displayNutrition priority ──
assert.strictEqual(N.isStale({ ...recipe }), false, "no saved estimate -> not stale");
const withFresh = { ...recipe, nutrition: { calories: 300, basis: fp1 } };
assert.strictEqual(N.isStale(withFresh), false, "matching basis -> fresh");
const withStale = { ...changed, nutrition: { calories: 300, basis: fp1 } };
assert.strictEqual(N.isStale(withStale), true, "ingredients changed since estimate -> stale");

// displayNutrition prefers a saved estimate, then import macros, then nothing.
const est = N.displayNutrition({ ...recipe, nutrition: { calories: 300, protein: 20, basis: fp1 } });
assert.strictEqual(est.source, "estimate");
const imp = N.displayNutrition({ ...recipe, macros: { calories: 250, protein: 15, carbs: 10, fat: 5 } });
assert.strictEqual(imp.source, "source");
assert.strictEqual(imp.values.calories, 250);
assert.strictEqual(N.displayNutrition({ ...recipe }), null, "no macros + no estimate -> null (UI offers Estimate)");

// ── nutritionPrompt: small, ingredient-only, and billed as 1 Assist ──
const prompt = N.nutritionPrompt(recipe);
assert.ok(prompt.system && Array.isArray(prompt.messages) && prompt.messages.length === 1);
const text = prompt.messages[0].content;
assert.ok(/broth/i.test(text) && /chicken/i.test(text), "ingredients are included");
assert.ok(!/Mix|step|direction/i.test(text), "steps are NOT included (keeps the call small)");
// The server must classify this prompt as the `nutrition` feature, costing 1 Assist.
assert.strictEqual(detectAiFeature({ system: prompt.system, messages: prompt.messages }), "nutrition", "server bills the prompt as nutrition");
assert.strictEqual(aiAssistCost("nutrition"), 1, "nutrition costs exactly 1 AI Assist");
// And it must NOT trip the import/adjust classifiers.
assert.notStrictEqual(detectAiFeature({ messages: prompt.messages }), "import");
assert.notStrictEqual(detectAiFeature({ messages: prompt.messages }), "adjust");

console.log("nutrition-test: ok");
