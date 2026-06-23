const assert = require("assert");
const app = require("../server");
const { detectAiFeature, isBillableAiFeature } = app._test;

// The real extraction prompt the import flow sends.
const importBody = {
  system: "You are a recipe extraction assistant. Return ONLY a raw JSON object.",
  messages: [{ role: "user", content: "Extract the recipe ONLY from the source material below." }],
};
assert.strictEqual(detectAiFeature(importBody), "import", "extraction is classified as import");
assert.strictEqual(isBillableAiFeature("import"), true, "imports are billable");

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

console.log("ai-credits-test: ok");
