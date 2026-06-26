/*
 * Tests for constrained AI extraction (tool use) — Phase 2. Pure, offline:
 * validates the tool schema and the response interpreter against mock Anthropic
 * responses (no network / no key / no AI spend).
 */
const assert = require("assert");
const S = require("../public/recipe-schema");

// ── Tools are well-formed for the Anthropic tools API ──
assert.strictEqual(S.EXTRACTION_TOOLS.length, 2);
const byName = Object.fromEntries(S.EXTRACTION_TOOLS.map((t) => [t.name, t]));
assert.ok(byName.save_recipe && byName.report_issue, "both tools present");
S.EXTRACTION_TOOLS.forEach((t) => {
  assert.ok(typeof t.name === "string" && t.description && t.input_schema, t.name + " is complete");
  assert.strictEqual(t.input_schema.type, "object");
});
assert.deepStrictEqual(byName.save_recipe.input_schema.required, ["title", "sections"], "recipe requires title + sections");
assert.deepStrictEqual(byName.report_issue.input_schema.properties.type.enum,
  ["multiple_recipes_detected", "not_enough_recipe_text", "unknown_recipe"]);
assert.strictEqual(S.TOOL_CHOICE_ANY.type, "any", "default forces a tool call, model picks which");
assert.deepStrictEqual(S.TOOL_CHOICE_RECIPE, { type: "tool", name: "save_recipe" });

// ── interpretToolResponse: save_recipe -> recipe ──
const recipeResp = {
  stop_reason: "tool_use",
  content: [
    { type: "text", text: "" },
    { type: "tool_use", id: "tu_1", name: "save_recipe", input: { title: "Banana Bread", sections: [{ name: "Main", ingredients: [{ id: "i1", name: "flour" }], steps: [{ id: "s1", text: "Mix." }] }] } },
  ],
};
const r = S.interpretToolResponse(recipeResp);
assert.ok(r && r.recipe && r.recipe.title === "Banana Bread", "save_recipe -> recipe object");
assert.strictEqual(r.error, undefined);

// ── report_issue: multiple recipes -> the same error shape the old path produced ──
const multiResp = { content: [{ type: "tool_use", name: "report_issue", input: { type: "multiple_recipes_detected", recipes: ["Cookies", "Brownies"] } }] };
const m = S.interpretToolResponse(multiResp);
assert.strictEqual(m.error, "multiple_recipes_detected");
assert.deepStrictEqual(m.recipes, ["Cookies", "Brownies"]);

const thinResp = { content: [{ type: "tool_use", name: "report_issue", input: { type: "not_enough_recipe_text", message: "Try Paste Text." } }] };
assert.strictEqual(S.interpretToolResponse(thinResp).error, "not_enough_recipe_text");

// ── No tool_use (model returned text) -> null so the caller falls back to text parse ──
assert.strictEqual(S.interpretToolResponse({ content: [{ type: "text", text: '{"title":"x"}' }] }), null);
assert.strictEqual(S.interpretToolResponse({ content: [] }), null);
assert.strictEqual(S.interpretToolResponse({}), null);
assert.strictEqual(S.textContent({ content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }] }), "hello world");

console.log("recipe-schema-test: ok");
