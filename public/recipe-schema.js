/*
 * RecipeBoxSchema — constrained AI extraction via Anthropic tool use.
 *
 * Instead of asking the model to "return ONLY raw JSON" (and repairing it when it
 * isn't), we give it typed tools and force a tool call. The model fills a typed
 * structure, so we get valid, complete JSON far more reliably — retiring most of
 * the JSON-repair pass. Two tools so the multi-recipe / not-enough-text signals
 * still work:
 *   - save_recipe: the extracted recipe in the RecipeBox shape.
 *   - report_issue: multiple recipes detected / not enough text / not a recipe.
 *
 * interpretToolResponse() turns an Anthropic response into a recipe object, an
 * error object (same shape the old text path produced), or null (no tool_use ->
 * the caller falls back to text parsing). Pure: no DOM/network. window global +
 * Node require for tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RecipeBoxSchema = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var INGREDIENT_SCHEMA = {
    type: "object",
    properties: {
      id: { type: "string", description: "Stable id like i1, i2 (referenced by step ingredientRefs)." },
      amount: { type: "string", description: "Quantity as written, e.g. '2', '1 1/2', '1-2'. Empty if none." },
      unit: { type: "string", description: "Unit as written, e.g. 'cup', 'tbsp', 'clove'. Empty if none." },
      name: { type: "string", description: "Clean ingredient name only, e.g. 'all-purpose flour'. Do not include parenthetical metric quantities here." },
      weightAmount: { type: "string", description: "Source-provided metric/weight alternate, e.g. '222' from '1 cup (222g) butter'. Leave empty if absent." },
      weightUnit: { type: "string", description: "Unit for weightAmount, e.g. 'g', 'kg', 'ml'. Leave empty if absent." },
      raw: { type: "string", description: "Original ingredient line for audit/source preservation." },
    },
    required: ["name"],
  };

  var STEP_SCHEMA = {
    type: "object",
    properties: {
      id: { type: "string", description: "Stable id like s1, s2." },
      text: { type: "string", description: "One instruction step. Reference ingredients inline as {i1}." },
      ingredientRefs: { type: "array", items: { type: "string" }, description: "Ingredient ids used in this step." },
    },
    required: ["text"],
  };

  var SECTION_SCHEMA = {
    type: "object",
    properties: {
      name: { type: "string", description: "Component name, e.g. 'Main', 'Crust', 'Sauce'." },
      ingredients: { type: "array", items: INGREDIENT_SCHEMA },
      steps: { type: "array", items: STEP_SCHEMA },
    },
    required: ["ingredients", "steps"],
  };

  // Mirrors the RecipeBox recipe shape the app already saves.
  var RECIPE_INPUT_SCHEMA = {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      servings: { type: "integer", description: "Number of servings the recipe yields." },
      prepTime: { type: "string", description: "e.g. '20 min'." },
      cookTime: { type: "string", description: "e.g. '35 min'." },
      totalTime: { type: "string" },
      heroImage: { type: "string", description: "Image URL if one is given by the source." },
      category: { type: "string", description: "Real food type, e.g. 'Baked Goods', 'Desserts', 'Entrées'. Never 'Copycat'." },
      notes: { type: "string", description: "Source-grounded tips only; do not invent." },
      tags: { type: "array", items: { type: "string" }, description: "Concise labels. 'Copycat' may be a tag, never a category." },
      macros: {
        type: "object",
        properties: {
          calories: { type: "number" }, protein: { type: "number" }, carbs: { type: "number" },
          fat: { type: "number" }, fiber: { type: "number" },
        },
      },
      sections: { type: "array", items: SECTION_SCHEMA },
    },
    required: ["title", "sections"],
  };

  var ISSUE_INPUT_SCHEMA = {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["multiple_recipes_detected", "not_enough_recipe_text", "unknown_recipe"],
        description: "multiple_recipes_detected: the source has several distinct recipes; not_enough_recipe_text: too little to extract; unknown_recipe: no recipe present.",
      },
      recipes: { type: "array", items: { type: "string" }, description: "For multiple_recipes_detected: the detected recipe names." },
      message: { type: "string" },
    },
    required: ["type"],
  };

  var EXTRACTION_TOOLS = [
    {
      name: "save_recipe",
      description: "Save the single recipe extracted from the source, grounded ONLY in the source material. Do not invent ingredients, steps, quantities, times, or notes.",
      input_schema: RECIPE_INPUT_SCHEMA,
    },
    {
      name: "report_issue",
      description: "Use ONLY when you cannot return one recipe: the source clearly contains multiple distinct recipes/variants (do not merge or pick one silently — list their names), or there isn't enough recipe text, or there's no recipe at all.",
      input_schema: ISSUE_INPUT_SCHEMA,
    },
  ];

  // Force a tool call; let the model choose save_recipe vs report_issue.
  var TOOL_CHOICE_ANY = { type: "any" };
  // Force the recipe tool specifically (focused re-extraction of one named recipe).
  var TOOL_CHOICE_RECIPE = { type: "tool", name: "save_recipe" };

  function extractToolUse(data) {
    var blocks = (data && data.content) || [];
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i] && blocks[i].type === "tool_use") return blocks[i];
    }
    return null;
  }

  // Anthropic response -> { recipe } | { error, recipes, message } | null.
  function interpretToolResponse(data) {
    var tu = extractToolUse(data);
    if (!tu) return null;
    if (tu.name === "report_issue") {
      var inp = tu.input || {};
      return { error: inp.type || "unknown_recipe", recipes: Array.isArray(inp.recipes) ? inp.recipes : [], message: inp.message || "" };
    }
    if (tu.name === "save_recipe") {
      return { recipe: tu.input || {} };
    }
    return null;
  }

  // Best-effort text fallback content (when the model returned text, not a tool).
  function textContent(data) {
    return ((data && data.content) || []).map(function (b) { return (b && b.text) || ""; }).join("");
  }

  return {
    RECIPE_INPUT_SCHEMA: RECIPE_INPUT_SCHEMA,
    ISSUE_INPUT_SCHEMA: ISSUE_INPUT_SCHEMA,
    EXTRACTION_TOOLS: EXTRACTION_TOOLS,
    TOOL_CHOICE_ANY: TOOL_CHOICE_ANY,
    TOOL_CHOICE_RECIPE: TOOL_CHOICE_RECIPE,
    extractToolUse: extractToolUse,
    interpretToolResponse: interpretToolResponse,
    textContent: textContent,
  };
});
