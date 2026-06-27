/*
 * RecipeBoxNormalize — Stage 2 of the import pipeline: deterministic, AI-free
 * normalization so every imported recipe follows one consistent RecipeBox style,
 * regardless of source.
 *
 *   Extract (faithful) -> NORMALIZE (this, deterministic) -> Cleanup (AI only if
 *   needed) -> Save -> Display
 *
 * Philosophy: extraction decides WHAT the recipe is; normalization decides HOW
 * RecipeBox displays it. This stage NEVER changes quantities, ingredient order,
 * structure, cooking times, or meaning — it only standardizes formatting:
 * abbreviations, fractions, spacing/punctuation/capitalization, and a small set
 * of unambiguous typos. Temperature unit conversion (F<->C) is display-time so it
 * follows the user's chosen mode.
 *
 * Pure: no DOM/network/AI. window.RecipeBoxNormalize + Node require for tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./shopping-list"));
  else root.RecipeBoxNormalize = factory(root.RecipeBoxShopping);
})(typeof self !== "undefined" ? self : this, function (Shopping) {
  "use strict";

  function canonicalUnit(u) {
    // No amount -> canonical singular token (display re-pluralizes "cup"/"cups").
    return (Shopping && Shopping.abbreviateUnit) ? Shopping.abbreviateUnit(u) : String(u == null ? "" : u);
  }

  // Unambiguous misspellings only — never anything that could be a real word.
  var COMMON_TYPOS = {
    togehter: "together", togethr: "together", toghether: "together", togeher: "together",
    occassionally: "occasionally", occasionaly: "occasionally", occassion: "occasion",
    occured: "occurred", occuring: "occurring",
    seperate: "separate", seperated: "separated", seperately: "separately",
    recieve: "receive", recieved: "received",
    untill: "until", unil: "until",
    minutues: "minutes", mintues: "minutes", minuts: "minutes", minutos: "minutes",
    temperatue: "temperature", tempurature: "temperature",
    prehat: "preheat", peheat: "preheat", preheaat: "preheat",
    refridgerate: "refrigerate", refridgerator: "refrigerator",
    ingrediants: "ingredients", ingrediant: "ingredient",
    aprox: "approx", approxiamtely: "approximately", aproximately: "approximately",
    consistancy: "consistency", consitency: "consistency",
    saute: "sauté", sautee: "sauté",
  };

  function normalizeFractions(s) {
    return String(s == null ? "" : s)
      .replace(/¼/g, "1/4").replace(/½/g, "1/2").replace(/¾/g, "3/4")
      .replace(/⅓/g, "1/3").replace(/⅔/g, "2/3")
      .replace(/⅛/g, "1/8").replace(/⅜/g, "3/8").replace(/⅝/g, "5/8").replace(/⅞/g, "7/8")
      .replace(/⅕/g, "1/5").replace(/⅖/g, "2/5").replace(/⅗/g, "3/5").replace(/⅘/g, "4/5")
      .replace(/⅙/g, "1/6")
      // Smashed mixed fractions from some sources: "11/2" -> "1 1/2".
      .replace(/\b(\d+)([1-9])\/(2|3|4|5|6|8)\b/g, function (m, whole, n, d) {
        return (Number(n) < Number(d)) ? whole + " " + n + "/" + d : m;
      });
  }

  function fixTypos(text) {
    return String(text == null ? "" : text).replace(/[A-Za-zÀ-ÿ]+/g, function (word) {
      var lower = word.toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(COMMON_TYPOS, lower)) return word;
      var fixed = COMMON_TYPOS[lower];
      // Preserve simple capitalization of the original word.
      if (word === word.toUpperCase() && word.length > 1) return fixed.toUpperCase();
      if (word[0] === word[0].toUpperCase()) return fixed.charAt(0).toUpperCase() + fixed.slice(1);
      return fixed;
    });
  }

  // Core text normalizer: fractions, typos, doubled words, spacing, punctuation.
  // opts.sentence: also sentence-case the start + ensure terminal punctuation.
  function normalizeText(text, opts) {
    opts = opts || {};
    var s = normalizeFractions(String(text == null ? "" : text));
    s = fixTypos(s);
    s = s.replace(/[ \t ]+/g, " ");                 // collapse runs of spaces
    s = s.replace(/\s+([,.;:!?])/g, "$1");               // no space before punctuation
    s = s.replace(/([,;:])(?=\S)/g, "$1 ");              // a space after , ; :
    s = s.replace(/\b(\w{1,12})\s+\1\b/gi, function (m, w) { // collapse doubled words ("the the")
      return /^\d+([./]\d+)?$/.test(w) ? m : w;          // but keep repeated numbers (e.g. "2 2")
    });
    s = s.replace(/[ \t]*\n[ \t]*/g, "\n").trim();
    if (opts.sentence && s) {
      s = s.charAt(0).toUpperCase() + s.slice(1);
      if (!/[.!?:)"]$/.test(s)) s += ".";
    }
    return s;
  }

  function normalizeIngredient(ing) {
    if (typeof ing === "string") return normalizeText(ing);
    if (!ing || typeof ing !== "object") return ing;
    var out = Object.assign({}, ing);
    if (out.amount != null) out.amount = normalizeFractions(String(out.amount)).replace(/\s+/g, " ").trim();
    if (out.unit != null && String(out.unit).trim()) out.unit = canonicalUnit(out.unit);
    if (out.name != null) out.name = normalizeText(out.name); // name: clean but no forced period
    if (out.weightUnit != null && String(out.weightUnit).trim()) out.weightUnit = canonicalUnit(out.weightUnit);
    return out;
  }

  // Normalize a whole recipe (returns a NEW object; input is not mutated). Only
  // formatting changes — quantities, units' meaning, order, and structure are
  // preserved exactly.
  function normalizeRecipe(recipe) {
    if (!recipe || typeof recipe !== "object") return recipe;
    var out = Object.assign({}, recipe);
    if (out.title != null) out.title = normalizeText(out.title);
    if (out.description != null) out.description = normalizeText(out.description);
    if (out.notes != null) out.notes = normalizeText(out.notes);
    if (Array.isArray(out.sections)) {
      out.sections = out.sections.map(function (sec) {
        if (!sec || typeof sec !== "object") return sec;
        var s = Object.assign({}, sec);
        if (s.name != null) s.name = normalizeText(s.name);
        if (Array.isArray(s.ingredients)) s.ingredients = s.ingredients.map(normalizeIngredient);
        if (Array.isArray(s.steps)) s.steps = s.steps.map(function (st) {
          if (typeof st === "string") return normalizeText(st, { sentence: true });
          if (!st || typeof st !== "object") return st;
          var step = Object.assign({}, st);
          if (step.text != null) step.text = normalizeText(step.text, { sentence: true });
          return step;
        });
        return s;
      });
    }
    return out;
  }

  // ---- Temperature display conversion (display-time, follows the user's mode) ----
  function roundTo(n, step) { return Math.round(n / step) * step; }
  // Convert temperatures embedded in free text to the target system ('us' -> °F,
  // 'metric' -> °C). Only matches numbers explicitly marked as degrees, so plain
  // numbers (counts, times) are never touched. Display-only.
  function convertTempsInText(text, system) {
    var s = String(text == null ? "" : text);
    var to = system === "metric" ? "metric" : "us";
    var re = /(-?\d{1,3})\s*(?:°|º|\bdeg(?:rees)?\.?)\s*([CFcf])\b/g;
    return s.replace(re, function (m, numStr, letter) {
      var n = Number(numStr);
      var isC = /c/i.test(letter);
      if (to === "us" && isC) {
        var f = n * 9 / 5 + 32;
        // Oven-range temps read conventionally in 25° steps (175°C -> 350°F).
        return (f >= 200 ? roundTo(f, 25) : roundTo(f, 5)) + "°F";
      }
      if (to === "metric" && !isC) return roundTo((n - 32) * 5 / 9, 5) + "°C";
      return (n + "°" + letter.toUpperCase()); // already in target system — tidy the symbol
    });
  }

  // ---- Import quality audit (deterministic) ----
  // Flags issues for the review banner / to decide whether minimal AI cleanup is
  // warranted. Never changes the recipe.
  function ingredientNames(recipe) {
    var out = [];
    ((recipe && recipe.sections) || []).forEach(function (sec) {
      ((sec && sec.ingredients) || []).forEach(function (i) { var n = (i && (i.name || i.raw)) || ""; if (n) out.push(n); });
    });
    return out;
  }
  function hasTypos(text) {
    var found = [];
    String(text || "").replace(/[A-Za-z]+/g, function (w) { if (Object.prototype.hasOwnProperty.call(COMMON_TYPOS, w.toLowerCase())) found.push(w); return w; });
    return found;
  }
  function auditRecipe(recipe, system) {
    var warnings = [];
    var flags = { typos: false, mixedUnits: false, mixedTemp: false, duplicateIngredients: false, doubledWords: false };
    if (!recipe || typeof recipe !== "object") return { warnings: warnings, flags: flags, needsCleanup: false };
    var allText = [recipe.title, recipe.description, recipe.notes]
      .concat(((recipe.sections || []).flatMap(function (s) { return (s.steps || []).map(function (st) { return typeof st === "string" ? st : (st && st.text) || ""; }); })))
      .join(" \n ");
    // Spelling.
    if (hasTypos(allText).length) { flags.typos = true; warnings.push("Some words look misspelled."); }
    // Doubled words.
    if (/\b(\w{2,12})\s+\1\b/i.test(allText)) { flags.doubledWords = true; }
    // Temperatures present in BOTH systems (mixed) or not matching the display mode.
    var hasC = /\d\s*(?:°|º|deg(?:rees)?\.?)\s*c\b/i.test(allText);
    var hasF = /\d\s*(?:°|º|deg(?:rees)?\.?)\s*f\b/i.test(allText);
    if (hasC && hasF) { flags.mixedTemp = true; warnings.push("Recipe mixes °F and °C."); }
    else if (system === "us" && hasC && !hasF) { flags.mixedTemp = true; }
    else if (system === "metric" && hasF && !hasC) { flags.mixedTemp = true; }
    // Mixed measurement systems in ingredient units.
    var units = ((recipe.sections || []).flatMap(function (s) { return (s.ingredients || []).map(function (i) { return String((i && i.unit) || "").toLowerCase(); }); }));
    var metricU = units.some(function (u) { return /^(g|kg|ml|l|gram|kilogram|milliliter|liter|litre)$/.test(u); });
    var usU = units.some(function (u) { return /^(cup|cups|tbsp|tsp|oz|lb|fl oz|pt|qt|gal|tablespoon|teaspoon|ounce|pound)$/.test(u); });
    if (metricU && usU) { flags.mixedUnits = true; warnings.push("Recipe mixes US and metric ingredient units."); }
    // Duplicate ingredient names within a section (often a true compound, but flag).
    (recipe.sections || []).forEach(function (sec) {
      var names = ((sec && sec.ingredients) || []).map(function (i) { return String((i && i.name) || "").toLowerCase().trim(); }).filter(Boolean);
      if (new Set(names).size < names.length) flags.duplicateIngredients = true;
    });
    var names = ingredientNames(recipe);
    flags.duplicateNamesAcross = new Set(names.map(function (n) { return n.toLowerCase().trim(); })).size < names.length;
    var needsCleanup = flags.typos || flags.doubledWords; // text issues AI can safely fix
    return { warnings: warnings.slice(0, 4), flags: flags, needsCleanup: needsCleanup };
  }

  return {
    normalizeText: normalizeText,
    normalizeFractions: normalizeFractions,
    fixTypos: fixTypos,
    normalizeIngredient: normalizeIngredient,
    normalizeRecipe: normalizeRecipe,
    convertTempsInText: convertTempsInText,
    auditRecipe: auditRecipe,
    COMMON_TYPOS: COMMON_TYPOS,
  };
});
