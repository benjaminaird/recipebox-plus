// Server-dependent half of the former nutrition-test: the Express server must
// classify the nutrition prompt as the `nutrition` feature and bill it at
// exactly 1 AI Assist. Loads server.js (Express, pg), so it runs on Node only.
// No database, network or credentials are needed.
const assert = require("assert");
const N = require("../packages/recipe-core/src/nutrition");
const app = require("../server");
const { detectAiFeature, aiAssistCost } = app._test;

const recipe = {
  title: "Test Soup", servings: 4,
  sections: [{ name: "Main", ingredients: [
    { amount: "2", unit: "cup", name: "broth" },
    { amount: "1", unit: "lb", name: "chicken" },
  ] }],
};
const prompt = N.nutritionPrompt(recipe);

// The server must classify this prompt as the `nutrition` feature, costing 1 Assist.
assert.strictEqual(detectAiFeature({ system: prompt.system, messages: prompt.messages }), "nutrition", "server bills the prompt as nutrition");
assert.strictEqual(aiAssistCost("nutrition"), 1, "nutrition costs exactly 1 AI Assist");
// And it must NOT trip the import/adjust classifiers.
assert.notStrictEqual(detectAiFeature({ messages: prompt.messages }), "import");
assert.notStrictEqual(detectAiFeature({ messages: prompt.messages }), "adjust");

console.log("nutrition-billing-test: ok");
