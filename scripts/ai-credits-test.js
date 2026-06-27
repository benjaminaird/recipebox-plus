const assert = require("assert");
const app = require("../server");
const { detectAiFeature, isBillableAiFeature, aiAssistCost } = app._test;

// The real extraction prompt the import flow sends.
const importBody = {
  system: "You are a recipe extraction assistant. Return ONLY a raw JSON object.",
  messages: [{ role: "user", content: "Extract the recipe ONLY from the source material below." }],
};
assert.strictEqual(detectAiFeature(importBody), "import", "extraction is classified as import");
assert.strictEqual(isBillableAiFeature("import"), true, "imports are billable");

// The Stage-3 cleanup pass is an internal quality fix-up — classified and NOT billable.
const cleanupBody = { system: "This is a RecipeBox cleanup pass: correct obvious mistakes while preserving the recipe exactly.", messages: [{ role: "user", content: "Recipe to clean up: {}" }] };
assert.strictEqual(detectAiFeature(cleanupBody), "cleanup", "cleanup pass is classified as cleanup");
assert.strictEqual(isBillableAiFeature("cleanup"), false, "cleanup passes are NOT billable");
assert.strictEqual(aiAssistCost("cleanup"), 0, "cleanup costs 0 AI Assists");

// The hidden JSON-repair pass (parseImportedRecipe) must NOT bill a credit.
const repairBody = {
  system: "You repair malformed recipe JSON. Return ONLY one valid raw JSON object.",
  messages: [{ role: "user", content: "Repair this malformed RecipeBox recipe JSON. Return only valid JSON." }],
};
assert.strictEqual(detectAiFeature(repairBody), "repair", "JSON repair pass is classified as repair");
assert.strictEqual(isBillableAiFeature("repair"), false, "repair passes are NOT billable");

// Other user-facing features are billable.
const adjustBody = { system: "You are a culinary assistant.", messages: [{ role: "user", content: "Recipe: {} Request: make it spicier" }] };
assert.strictEqual(detectAiFeature(adjustBody), "adjust", "adjust is classified");
assert.strictEqual(isBillableAiFeature("adjust"), true, "adjust is billable");

const pantryBody = { system: "You are Pantry Chef inside RecipeBox.", messages: [{ role: "user", content: "ingredients I have: eggs" }] };
assert.strictEqual(detectAiFeature(pantryBody), "pantry", "pantry is classified");
assert.strictEqual(isBillableAiFeature("pantry"), true, "pantry is billable");

// Unknown calls fall back to general-ai and remain billable (conservative).
assert.strictEqual(detectAiFeature({ messages: [{ role: "user", content: "hello" }] }), "general-ai");
assert.strictEqual(isBillableAiFeature("general-ai"), true);

// New multi-cost features are classified before the broad 'adjust' pattern.
const mealPlanBody = { system: "You are a meal planner.", messages: [{ role: "user", content: "Generate a meal plan for the week. Request: balanced dinners." }] };
assert.strictEqual(detectAiFeature(mealPlanBody), "meal-plan", "weekly meal plan classified ahead of adjust");
const nutritionBody = { messages: [{ role: "user", content: "Estimate the nutrition / macros for this recipe." }] };
assert.strictEqual(detectAiFeature(nutritionBody), "nutrition", "nutrition classified");
const shopBody = { messages: [{ role: "user", content: "Optimize this shopping list and consolidate duplicates." }] };
assert.strictEqual(detectAiFeature(shopBody), "shopping-optimize", "shopping optimize classified");

// Cost map: the billable cost of each classified action.
assert.strictEqual(aiAssistCost(detectAiFeature(importBody)), 1, "import = 1 assist");
assert.strictEqual(aiAssistCost(detectAiFeature(adjustBody)), 2, "adjust = 2 assists");
assert.strictEqual(aiAssistCost(detectAiFeature(pantryBody)), 2, "pantry = 2 assists");
assert.strictEqual(aiAssistCost(detectAiFeature(mealPlanBody)), 4, "meal plan = 4 assists");
assert.strictEqual(aiAssistCost(detectAiFeature(repairBody)), 0, "repair = 0 assists (never billed)");

console.log("ai-credits-test: ok");
