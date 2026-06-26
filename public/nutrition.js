/*
 * RecipeBoxNutrition — shared, pure helpers for the AI nutrition/macros estimate.
 *
 * Loaded as a global (window.RecipeBoxNutrition) for the app and required by Node
 * unit tests (module.exports). No DOM, no network, no crypto — deterministic so
 * the same recipe always produces the same fingerprint and the same display shape.
 *
 * The estimate runs through the normal /api/ai proxy. nutritionPrompt() embeds a
 * classifier phrase ("estimate the nutrition" / "macros for this recipe") so the
 * server bills it as the `nutrition` feature (1 AI Assist), and avoids the import
 * ("extract the recipe") and adjust ("request:") phrases so it isn't misclassified.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RecipeBoxNutrition = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Display order + units. calories in kcal, sodium in mg, the rest in grams.
  var NUTRITION_FIELDS = [
    { key: "calories", label: "Calories", unit: "kcal" },
    { key: "protein", label: "Protein", unit: "g" },
    { key: "carbs", label: "Carbs", unit: "g" },
    { key: "fat", label: "Fat", unit: "g" },
    { key: "fiber", label: "Fiber", unit: "g" },
    { key: "sugar", label: "Sugar", unit: "g" },
    { key: "sodium", label: "Sodium", unit: "mg" },
  ];

  // Coerce "12g", "350 kcal", "1,200", 12 -> a finite number, else null.
  function num(v) {
    if (v == null) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var m = String(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    var n = parseFloat(m[0]);
    return isFinite(n) ? n : null;
  }

  function pick(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (obj[k] != null && obj[k] !== "") return obj[k];
    }
    return null;
  }

  function clampRound(n, integer) {
    if (n == null) return null;
    if (n < 0) n = 0;
    return integer ? Math.round(n) : Math.round(n * 10) / 10;
  }

  // Accept whatever key names the model (or an import's `macros`) used and coerce
  // to a fixed per-serving shape. Returns null if there's no usable macro data.
  function normalizeNutrition(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    var o = input;
    var out = {
      calories: clampRound(num(pick(o, ["calories", "calorie", "kcal", "energy", "cal"])), true),
      protein: clampRound(num(pick(o, ["protein", "protein_g", "proteins"])), false),
      carbs: clampRound(num(pick(o, ["carbs", "carbs_g", "carbohydrates", "carbohydrate", "total_carbohydrate", "net_carbs"])), false),
      fat: clampRound(num(pick(o, ["fat", "fat_g", "total_fat", "fats"])), false),
      fiber: clampRound(num(pick(o, ["fiber", "fiber_g", "dietary_fiber", "fibre"])), false),
      sugar: clampRound(num(pick(o, ["sugar", "sugar_g", "sugars", "total_sugars"])), false),
      sodium: clampRound(num(pick(o, ["sodium", "sodium_mg", "salt"])), true),
    };
    // Require at least one of the core macros to be present and meaningful.
    if (out.calories == null && out.protein == null && out.carbs == null && out.fat == null) return null;
    return out;
  }

  function hasAnyValue(n) {
    if (!n) return false;
    for (var i = 0; i < NUTRITION_FIELDS.length; i++) {
      if (n[NUTRITION_FIELDS[i].key] != null) return true;
    }
    return false;
  }

  // Tolerant parse of a model response: strip code fences and grab the outermost
  // JSON object, then normalize. Never throws.
  function parseNutrition(text) {
    if (text == null) return null;
    var s = String(text).replace(/```[a-z]*|```/gi, "").trim();
    var start = s.indexOf("{");
    var end = s.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return normalizeNutrition(JSON.parse(s.slice(start, end + 1)));
    } catch (e) {
      return null;
    }
  }

  // Flatten a recipe's ingredient list to readable "amount unit name" lines,
  // handling both string and object ingredient shapes.
  function ingredientLines(recipe) {
    var lines = [];
    var sections = (recipe && recipe.sections) || [];
    for (var i = 0; i < sections.length; i++) {
      var ings = (sections[i] && sections[i].ingredients) || [];
      for (var j = 0; j < ings.length; j++) {
        var ing = ings[j];
        if (typeof ing === "string") {
          if (ing.trim()) lines.push(ing.trim());
        } else if (ing && typeof ing === "object") {
          var parts = [ing.amount, ing.unit, ing.name].filter(function (p) { return p != null && String(p).trim() !== ""; });
          if (parts.length) lines.push(parts.join(" ").trim());
        }
      }
    }
    return lines;
  }

  function servingsOf(recipe) {
    var n = num(recipe && recipe.servings);
    return n && n > 0 ? Math.round(n) : 4;
  }

  // Deterministic FNV-1a-style fingerprint of the things that change the macros:
  // ingredient lines (sorted, case-insensitive) + servings. Used to detect when a
  // cached estimate is stale because the recipe was edited.
  function ingredientsFingerprint(recipe) {
    var lines = ingredientLines(recipe)
      .map(function (l) { return l.toLowerCase().replace(/\s+/g, " ").trim(); })
      .filter(Boolean)
      .sort();
    var canonical = servingsOf(recipe) + "|" + lines.join("|");
    var h = 0x811c9dc5;
    for (var i = 0; i < canonical.length; i++) {
      h ^= canonical.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
  }

  // True when a saved estimate no longer matches the current ingredients.
  function isStale(recipe) {
    var n = recipe && recipe.nutrition;
    if (!n || !n.basis) return false;
    return n.basis !== ingredientsFingerprint(recipe);
  }

  // What to show in the UI, in priority order:
  //   1. an AI estimate saved on the recipe (recipe.nutrition)
  //   2. macros captured during import (recipe.macros)
  //   3. nothing -> caller offers the "Estimate" action
  function displayNutrition(recipe) {
    if (!recipe) return null;
    if (recipe.nutrition && hasAnyValue(recipe.nutrition)) {
      return { values: recipe.nutrition, source: "estimate", stale: isStale(recipe) };
    }
    var fromImport = normalizeNutrition(recipe.macros);
    if (fromImport) return { values: fromImport, source: "source", stale: false };
    return null;
  }

  var NUTRITION_SYSTEM =
    "You estimate per-serving nutrition for a home recipe. Return ONLY a raw JSON object, " +
    "no markdown, no backticks, no prose. Start with { and end with }. " +
    'Shape: {"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0,"sodium":0}. ' +
    "All values are PER SERVING and numeric: calories in kcal, protein/carbs/fat/fiber/sugar in grams, sodium in milligrams. " +
    "Base the estimate only on the ingredients and serving count provided. It is an approximation; do not refuse. " +
    "If an ingredient amount is vague, make a reasonable typical assumption. Never include units in the numbers.";

  // Build the /api/ai request body. Sends only title, servings, and ingredient
  // lines (not steps) to keep the call small. The user text contains a nutrition
  // classifier phrase so the server bills exactly 1 AI Assist for `nutrition`.
  function nutritionPrompt(recipe) {
    var servings = servingsOf(recipe);
    var lines = ingredientLines(recipe);
    var content =
      "Estimate the nutrition (per-serving macros for this recipe).\n" +
      "Title: " + String((recipe && recipe.title) || "Recipe") + "\n" +
      "Servings: " + servings + "\n" +
      "Ingredients:\n" + (lines.length ? lines.map(function (l) { return "- " + l; }).join("\n") : "- (none provided)");
    return {
      system: NUTRITION_SYSTEM,
      messages: [{ role: "user", content: content }],
      maxTokens: 400,
    };
  }

  return {
    NUTRITION_FIELDS: NUTRITION_FIELDS,
    normalizeNutrition: normalizeNutrition,
    parseNutrition: parseNutrition,
    nutritionPrompt: nutritionPrompt,
    ingredientLines: ingredientLines,
    ingredientsFingerprint: ingredientsFingerprint,
    isStale: isStale,
    displayNutrition: displayNutrition,
    hasAnyValue: hasAnyValue,
    servingsOf: servingsOf,
  };
});
