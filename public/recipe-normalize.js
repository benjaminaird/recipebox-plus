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
    if (out.raw == null) {
      var rawParts = [out.amount, out.unit, out.name].filter(function (x) { return String(x || "").trim(); });
      if (rawParts.length) out.raw = rawParts.join(" ");
    }
    if (out.amount != null) out.amount = normalizeFractions(String(out.amount)).replace(/\s+/g, " ").trim();
    if (out.name != null) out.name = normalizeText(out.name); // name: clean but no forced period
    splitParentheticalMetric(out);
    if (out.unit != null && String(out.unit).trim()) out.unit = canonicalUnit(out.unit);
    if (out.weightUnit != null && String(out.weightUnit).trim()) out.weightUnit = canonicalUnit(out.weightUnit);
    return out;
  }

  function splitParentheticalMetric(ing) {
    if (!ing || typeof ing !== "object") return ing;
    var metricRe = /\(\s*([\d.,]+(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(g|gram|grams|kg|kilogram|kilograms|ml|milliliter|milliliters|l|liter|liters|litre|litres)\s*\)/i;
    var metricInsideParenRe = /\([^()]*?([\d.,]+(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(g|gram|grams|kg|kilogram|kilograms|ml|milliliter|milliliters|l|liter|liters|litre|litres)[^()]*?\)/i;
    var fields = ["name", "amount", "unit"];
    for (var i = 0; i < fields.length; i++) {
      var key = fields[i], value = String(ing[key] == null ? "" : ing[key]);
      for (var pass = 0; pass < 8; pass++) {
        var m = value.match(metricRe) || value.match(metricInsideParenRe);
        if (!m) break;
        if (!ing.weightAmount) ing.weightAmount = normalizeFractions(m[1]).replace(/,/g, "").trim();
        if (!ing.weightUnit) ing.weightUnit = m[2];
        value = value.replace(m[0], " ");
      }
      ing[key] = cleanEmptyParens(normalizeText(value.replace(/\s+/g, " ").trim()));
    }
    return ing;
  }

  function cleanEmptyParens(value) {
    var s = String(value == null ? "" : value);
    for (var i = 0; i < 3; i++) {
      s = s
        .replace(/\(\s*[,;:-]?\s*\)/g, " ")
        .replace(/\(\s*[,;:-]\s*/g, "(")
        .replace(/\s*[,;:-]\s*\)/g, ")")
        .replace(/\(\s*([^()]*)\s*\)/g, function (m, inner) {
          return inner && inner.trim() ? "(" + inner.trim() + ")" : " ";
        })
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
    }
    return s;
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
    s = s.replace(/(-?\d{2,3})\s*(°|º|deg(?:rees)?\.?)?\s*([Ff])\s*\(\s*(-?\d{2,3})\s*(°|º|deg(?:rees)?\.?)?\s*([Cc])\s*\)/g, function (m, f, fm, fl, c) {
      return to === "metric" ? (Number(c) + "°C") : (Number(f) + "°F");
    });
    s = s.replace(/(-?\d{2,3})\s*(°|º|deg(?:rees)?\.?)?\s*([Cc])\s*\(\s*(-?\d{2,3})\s*(°|º|deg(?:rees)?\.?)?\s*([Ff])\s*\)/g, function (m, c, cm, cl, f) {
      return to === "metric" ? (Number(c) + "°C") : (Number(f) + "°F");
    });
    // Matches "180°C", "180 deg C", "180 C", AND a bare "180c" (no degree symbol —
    // very common in scraped/handwritten recipes, e.g. "heat the oven to 180c").
    // The degree marker is optional; when it's absent we only treat the match as a
    // temperature if the value is in an oven-plausible range (100-550), so a bare
    // "2c" (cups) or a stray count is never mistaken for a temperature.
    var re = /(-?\d{1,3})\s*(°|º|deg(?:rees)?\.?)?\s*([CFcf])\b/g;
    return s.replace(re, function (m, numStr, marker, letter) {
      var n = Number(numStr);
      var isC = /c/i.test(letter);
      if (!marker && !(n >= 100 && n <= 550)) return m; // bare number: oven-range only
      if (to === "us" && isC) {
        var f = n * 9 / 5 + 32;
        // Oven-range temps read conventionally in 25° steps (175°C -> 350°F).
        return (f >= 200 ? roundTo(f, 25) : roundTo(f, 5)) + "°F";
      }
      if (to === "metric" && !isC) return roundTo((n - 32) * 5 / 9, 5) + "°C";
      return (n + "°" + letter.toUpperCase()); // already in target system — tidy the symbol
    });
  }

  // ---- Unit-to-unit conversion + locale formatting (single source of truth) ----
  // These are pure number<->number conversions that never need an ingredient
  // density table, so they're always safe:
  //   - weight <-> weight (g/kg <-> oz/lb): mass is mass.
  //   - volume <-> volume (ml/L <-> tsp/Tbsp/cup): volume is volume.
  // Density conversions (g of flour -> cups) stay in the display layer, which
  // has the trusted ingredient gram tables; here we deliberately stick to safe,
  // ambiguity-free conversions so direction text can be localized without it.
  var G_PER_OZ = 28.3495;
  var ML_PER_CUP = 240;
  function num(x) { return (Shopping && Shopping.amountToNumber) ? Shopping.amountToNumber(x) : (isFinite(Number(x)) ? Number(x) : null); }
  function frac(n) { return (Shopping && Shopping.numberToFraction) ? Shopping.numberToFraction(n) : String(n); }

  // grams -> US weight. Whole ounces read cleanly (400 g -> 14 oz, 85 g -> 3 oz);
  // at/above a pound, switch to quarter-pound steps. Weight-to-weight: always safe.
  function gramsToUsWeight(grams) {
    var oz = Number(grams) / G_PER_OZ;
    if (!isFinite(oz) || oz <= 0) return null;
    if (oz < 1) return { amount: frac(Math.max(0.25, Math.round(oz * 4) / 4)), unit: "oz" };
    if (oz < 16) return { amount: String(Math.round(oz)), unit: "oz" };
    return { amount: frac(Math.round((oz / 16) * 4) / 4), unit: "lb" };
  }
  function snapCups(cups) {
    var whole = Math.floor(cups), f = cups - whole;
    var opts = [0, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1], best = 0;
    for (var i = 0; i < opts.length; i++) if (Math.abs(f - opts[i]) < Math.abs(f - best)) best = opts[i];
    return best === 1 ? whole + 1 : whole + best;
  }
  // milliliters -> US volume (tsp/Tbsp/cup). Volume-to-volume: always safe.
  function mlToUsVolume(ml) {
    var n = Number(ml);
    if (!isFinite(n) || n <= 0) return null;
    var cups = n / ML_PER_CUP;
    if (cups >= 0.25) { var c = snapCups(cups); return { amount: frac(c), unit: c > 1 ? "cups" : "cup" }; }
    var tbsp = n / 15;
    if (tbsp >= 1) return { amount: frac(Math.round(tbsp * 2) / 2), unit: "Tbsp" };
    return { amount: frac(Math.max(0.25, Math.round((n / 5) * 4) / 4)), unit: "tsp" };
  }
  // US volume/weight -> metric (for Metric mode). Volume->ml, weight->g; promote
  // to L/kg past 1000. Safe (no density).
  function usToMetricWeight(grams) {
    var g = Math.round(Number(grams));
    return g >= 1000 ? { amount: frac(Math.round((g / 1000) * 100) / 100), unit: "kg" } : { amount: String(g), unit: "g" };
  }
  function usToMetricVolume(ml) {
    var m = Math.round(Number(ml));
    return m >= 1000 ? { amount: frac(Math.round((m / 1000) * 100) / 100), unit: "L" } : { amount: String(m), unit: "ml" };
  }
  var US_VOL_ML = { cup: 240, cups: 240, tbsp: 15, tablespoon: 15, tablespoons: 15, tsp: 5, teaspoon: 5, teaspoons: 5, "fl oz": 30, floz: 30 };
  var US_WT_G = { oz: 28.3495, ounce: 28.3495, ounces: 28.3495, lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592 };

  // Convert weight/volume measures embedded in free text (directions, notes) to
  // the display system. Only matches an explicit number+unit, so plain numbers
  // (counts, times, temperatures) are never touched. Display-only.
  function convertMeasuresInText(text, system) {
    var s = String(text == null ? "" : text);
    var amt = "(\\d+(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+)?|\\d+\\/\\d+)";
    if (system === "metric") {
      var reUs = new RegExp(amt + "\\s*(fl\\s?oz|fluid ounces?|cups?|tbsps?|tablespoons?|tsps?|teaspoons?|ounces?|oz|lbs?|pounds?)\\b", "gi");
      return s.replace(reUs, function (m, a, unit) {
        var n = num(a); if (n === null) return m;
        var u = unit.toLowerCase().replace(/\s+/g, " ");
        var key = u
          .replace(/^(tablespoons?|tbsps?)$/, "tbsp")
          .replace(/^(teaspoons?|tsps?)$/, "tsp")
          .replace(/^cups?$/, "cup")
          .replace(/^(fluid ounces?|fl ?oz)$/, "fl oz")
          .replace(/^ounces?$/, "oz")
          .replace(/^(lbs?|pounds?)$/, "lb");
        if (US_VOL_ML[key]) { var v = usToMetricVolume(n * US_VOL_ML[key]); return v.amount + " " + v.unit; }
        if (US_WT_G[key]) { var w = usToMetricWeight(n * US_WT_G[key]); return w.amount + " " + w.unit; }
        return m;
      });
    }
    var reMetric = new RegExp(amt + "\\s*(kg|kilograms?|grams?|g|millilitres?|milliliters?|ml|litres?|liters?|l)\\b", "gi");
    return s.replace(reMetric, function (m, a, unit) {
      var n = num(a); if (n === null) return m;
      var u = unit.toLowerCase(), c = null;
      if (/^k/.test(u)) c = gramsToUsWeight(n * 1000);
      else if (/^g/.test(u)) c = gramsToUsWeight(n);
      else if (/^m/.test(u)) c = mlToUsVolume(n);
      else if (/^l/.test(u)) c = mlToUsVolume(n * 1000);
      return c ? (c.amount + " " + c.unit) : m;
    });
  }

  // Ingredient-term localization (US house style). Conservative: only unambiguous
  // non-US -> US food terms. US-only; Metric mode leaves source terms as written.
  function capLike(sample, repl) {
    return (sample && sample[0] === sample[0].toUpperCase() && sample[0] !== sample[0].toLowerCase())
      ? repl.charAt(0).toUpperCase() + repl.slice(1) : repl;
  }
  var LOCALIZE_US = [
    [/\bcorn\s?flour\b/gi, "cornstarch"],          // UK cornflour = US cornstarch (thickener)
    [/\bicing sugar\b/gi, "powdered sugar"],
    [/\bcast[eo]r sugar\b/gi, "superfine sugar"],   // caster / castor
    [/\bbicarbonate of soda\b/gi, "baking soda"],
    [/\bself[- ]raising flour\b/gi, "self-rising flour"],
    [/\bplain flour\b/gi, "all-purpose flour"],
    [/\bdouble cream\b/gi, "heavy cream"],
    [/\bcourgettes?\b/gi, "zucchini"],
    [/\baubergines?\b/gi, "eggplant"],
    [/\brocket\b/gi, "arugula"],
    [/\bcoriander leaves\b/gi, "cilantro"],
  ];
  function localizeTerms(text, system) {
    if (system === "metric") return String(text == null ? "" : text);
    var s = String(text == null ? "" : text);
    LOCALIZE_US.forEach(function (pair) {
      s = s.replace(pair[0], function (m) { return capLike(m, pair[1]); });
    });
    return s;
  }
  function localizeIngredientName(name, system) { return localizeTerms(name, system); }

  // Full display-time localization of free text (directions, notes): temperature
  // + weight/volume conversion + term localization, all for the user's system.
  function localizeText(text, system) {
    var s = convertTempsInText(text, system);
    s = convertMeasuresInText(s, system);
    s = localizeTerms(s, system);
    return s;
  }

  function normalizeDisplayCompare(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/¼/g, "1/4").replace(/½/g, "1/2").replace(/¾/g, "3/4")
      .replace(/tablespoons?/g, "tbsp").replace(/teaspoons?/g, "tsp")
      .replace(/\bcups?\b/g, "cup")
      .replace(/\s+/g, " ")
      .trim();
  }

  function precedingMeasureMatches(textBefore, measureText) {
    var before = normalizeDisplayCompare(textBefore).replace(/[.,;:()]+$/g, "").trim();
    var measure = normalizeDisplayCompare(measureText);
    return !!measure && before.endsWith(measure);
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
    var flags = { typos: false, mixedUnits: false, mixedTemp: false, duplicateRows: false, doubledWords: false, missingQuantities: false };
    if (!recipe || typeof recipe !== "object") return { warnings: warnings, flags: flags, needsCleanup: false };
    var allText = [recipe.title, recipe.description, recipe.notes]
      .concat(((recipe.sections || []).flatMap(function (s) { return (s.steps || []).map(function (st) { return typeof st === "string" ? st : (st && st.text) || ""; }); })))
      .join(" \n ");
    // Spelling.
    if (hasTypos(allText).length) { flags.typos = true; warnings.push("Some words look misspelled."); }
    // Doubled words.
    if (/\b(\w{2,12})\s+\1\b/i.test(allText)) { flags.doubledWords = true; }
    // Source-level signals for the quality score only — NOT user warnings, since
    // the display layer now converts everything to the user's chosen system, so
    // mixed source units/temps never reach the cook. (Avoids noisy banners.)
    var hasC = /\d\s*(?:°|º|deg(?:rees)?\.?)\s*c\b/i.test(allText);
    var hasF = /\d\s*(?:°|º|deg(?:rees)?\.?)\s*f\b/i.test(allText);
    if (hasC && hasF) flags.mixedTemp = true;
    var units = ((recipe.sections || []).flatMap(function (s) { return (s.ingredients || []).map(function (i) { return String((i && i.unit) || "").toLowerCase(); }); }));
    var metricU = units.some(function (u) { return /^(g|kg|ml|l|gram|kilogram|milliliter|liter|litre)$/.test(u); });
    var usU = units.some(function (u) { return /^(cup|cups|tbsp|tsp|oz|lb|fl oz|pt|qt|gal|tablespoon|teaspoon|ounce|pound)$/.test(u); });
    if (metricU && usU) flags.mixedUnits = true;
    // True duplicate ingredient ROWS only (identical amount|unit|name in the same
    // section). This deliberately does NOT compare ingredients to direction text,
    // and does NOT flag a compound measure (same name, different unit) or an
    // ingredient legitimately reused across sections (cake vs. frosting).
    var dupRows = duplicateIngredientRows(recipe);
    if (dupRows.length) { flags.duplicateRows = true; warnings.push("Possible duplicate ingredient: " + dupRows.join(", ") + "."); }
    // Directions that name an ingredient (which HAS a quantity) but include no
    // number — the flagship case minimal AI cleanup can safely fix ("Add water."
    // -> "Add 2 Tbsp water.").
    var missing = missingDirectionQuantities(recipe);
    if (missing.length) { flags.missingQuantities = true; warnings.push("Some directions may be missing amounts."); }
    var needsCleanup = !!(flags.typos || flags.doubledWords || flags.missingQuantities);
    return { warnings: warnings.slice(0, 4), flags: flags, missing: missing, needsCleanup: needsCleanup };
  }

  // True duplicate ingredient ROWS: an identical (amount|unit|name) row appearing
  // more than once within ONE section. Compares ingredient rows to ingredient
  // rows only — never to directions — so an ingredient that also appears in a
  // step is never a "duplicate". Same name + different amount/unit (a compound
  // measure) and the same ingredient reused across sections are both fine.
  function duplicateIngredientRows(recipe) {
    var dups = [];
    ((recipe && recipe.sections) || []).forEach(function (sec) {
      var seen = Object.create(null);
      ((sec && sec.ingredients) || []).forEach(function (i) {
        if (!i || typeof i !== "object") return;
        var name = String(i.name || "").toLowerCase().replace(/\s+/g, " ").trim();
        if (!name) return;
        var sig = [String(i.amount == null ? "" : i.amount).trim(), String(i.unit || "").toLowerCase().trim(), name].join("|");
        if (seen[sig]) { if (dups.indexOf(i.name) === -1) dups.push(i.name); }
        else seen[sig] = true;
      });
    });
    return dups.slice(0, 5);
  }

  // ---- Import quality score (deterministic, 0-100) ----
  // Combines the audit flags and (optional) source grounding into one score +
  // band, used to decide whether a recipe needs a review banner. Tuned to be
  // useful, not noisy: only real problems pull the score down.
  function qualityScore(recipe, opts) {
    opts = opts || {};
    var system = opts.system || "us";
    var grounding = opts.grounding || null; // { checkable, coverage, dropped }
    var audit = auditRecipe(recipe, system);
    var score = 100;
    var reasons = [];
    if (audit.flags.mixedUnits) { score -= 8; reasons.push("source mixed US/metric units"); }
    if (audit.flags.mixedTemp) { score -= 5; reasons.push("source mixed °F/°C"); }
    if (audit.flags.typos) { score -= 6; reasons.push("possible misspellings"); }
    if (audit.flags.doubledWords) { score -= 3; }
    if (audit.flags.missingQuantities) { score -= 6; reasons.push("directions missing amounts"); }
    if (audit.flags.duplicateRows) { score -= 10; reasons.push("duplicate ingredient lines"); }
    if (grounding && grounding.checkable) {
      var cov = grounding.coverage == null ? 1 : grounding.coverage;
      if (cov < 1) { score -= Math.round((1 - cov) * 40); reasons.push("low source grounding"); }
      if (grounding.dropped && grounding.dropped.length) { score -= 8; reasons.push("source ingredient may be missing"); }
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
    var band = score >= 95 ? "Excellent" : score >= 80 ? "Good" : score >= 60 ? "Needs Review" : "Poor";
    return { score: score, band: band, reasons: reasons.slice(0, 4), needsReview: score < 80 };
  }

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  var ALIAS_DROP = /\b(salted|unsalted|granulated|powdered|confectioners?|all[- ]purpose|plain|self[- ]rising|self[- ]raising|chopped|softened|melted|room temperature|large|small|fresh|finely|roughly|crushed|mini)\b/g;
  var AMOUNT_WORD = "(?:\\d|¼|½|¾|⅓|⅔|⅛|⅜|⅝|⅞|one|two|three|four|five|six|seven|eight|nine|ten|a|an)";
  function cleanIngredientName(name) {
    return String(name || "").toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^a-z0-9& -]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function ingredientAliases(ing, sectionIngredients) {
    var full = cleanIngredientName(ing && ing.name);
    if (!full) return [];
    var aliases = [full];
    var rawName = String((ing && ing.name) || "").toLowerCase();
    if (rawName.indexOf(",") !== -1) {
      var pieces = rawName.split(",").map(cleanIngredientName).filter(Boolean);
      if (pieces.length >= 2) aliases.push(pieces.slice(1).join(" ") + " " + pieces[0]);
    }
    var stripped = full.replace(ALIAS_DROP, " ").replace(/\s+/g, " ").trim();
    if (stripped && stripped !== full) aliases.push(stripped);
    var words = stripped.split(/\s+/).filter(Boolean);
    if (words.length > 1) aliases.push(words.slice(-2).join(" "));
    if (words.length) aliases.push(words[words.length - 1]);
    var counts = Object.create(null);
    (sectionIngredients || []).forEach(function (other) {
      var seen = Object.create(null);
      ingredientAliasesShallow(other).forEach(function (a) {
        if (seen[a]) return;
        seen[a] = true;
        counts[a] = (counts[a] || 0) + 1;
      });
    });
    return aliases
      .filter(function (a, idx, arr) { return a && arr.indexOf(a) === idx; })
      .filter(function (a) { return a.length >= 4 || /^(egg|eggs)$/.test(a); })
      .filter(function (a) { return counts[a] == null || counts[a] === 1 || a === full; })
      .sort(function (a, b) { return b.length - a.length; });
  }
  function ingredientAliasesShallow(ing) {
    var full = cleanIngredientName(ing && ing.name);
    if (!full) return [];
    var rawName = String((ing && ing.name) || "").toLowerCase();
    var commaAliases = [];
    if (rawName.indexOf(",") !== -1) {
      var pieces = rawName.split(",").map(cleanIngredientName).filter(Boolean);
      if (pieces[0]) {
        commaAliases.push(pieces[0]);
        var baseWords = pieces[0].split(/\s+/).filter(Boolean);
        if (baseWords.length > 1) commaAliases.push(baseWords.slice(-2).join(" "));
        if (baseWords.length) commaAliases.push(baseWords[baseWords.length - 1]);
      }
      if (pieces.length >= 2) commaAliases.push(pieces.slice(1).join(" ") + " " + pieces[0]);
    }
    var stripped = full.replace(ALIAS_DROP, " ").replace(/\s+/g, " ").trim();
    var words = stripped.split(/\s+/).filter(Boolean);
    return [full].concat(commaAliases, [stripped, words.slice(-2).join(" "), words[words.length - 1]]).filter(Boolean);
  }
  function quantityAwareDirections(recipe) {
    if (!recipe || !Array.isArray(recipe.sections)) return recipe;
    var out = Object.assign({}, recipe);
    out.sections = recipe.sections.map(function (sec) {
      if (!sec || !Array.isArray(sec.steps) || !Array.isArray(sec.ingredients)) return sec;
      var ingredients = sec.ingredients;
      var next = Object.assign({}, sec);
      next.steps = sec.steps.map(function (step) {
        var st = (typeof step === "string") ? { text: step } : Object.assign({}, step || {});
        var text = String(st.text || "");
        if (!text.trim()) return st;
        var refs = Array.isArray(st.ingredientRefs) ? st.ingredientRefs.slice() : [];
        ingredients.forEach(function (ing) {
          if (!ing || !ing.id || !String(ing.amount || "").trim() || text.indexOf("{" + ing.id + "}") !== -1) return;
          var aliases = ingredientAliases(ing, ingredients);
          for (var ai = 0; ai < aliases.length; ai++) {
            var alias = aliases[ai];
            var re = new RegExp("\\b(?:the\\s+)?(" + escapeRe(alias) + ")\\b", "i");
            var match = text.match(re);
            if (!match) continue;
            var before = text.slice(Math.max(0, match.index - 28), match.index).toLowerCase();
            if (new RegExp("\\b" + AMOUNT_WORD + "\\b\\s*(?:[\\w/-]+\\s*){0,4}$", "i").test(before)) continue;
            text = text.slice(0, match.index) + "{" + ing.id + "}" + text.slice(match.index + match[0].length);
            if (refs.indexOf(ing.id) === -1) refs.push(ing.id);
            break;
          }
        });
        st.text = text;
        st.ingredientRefs = refs;
        return st;
      });
      return next;
    });
    return out;
  }
  // Conservative: a step with NO digit anywhere that names an ingredient (>=4
  // chars) which itself has a quantity. Drops {id} chips first (those already
  // inject the amount on display). Used only to decide whether to run cleanup.
  function missingDirectionQuantities(recipe) {
    var out = [];
    ((recipe && recipe.sections) || []).forEach(function (sec, si) {
      var measured = ((sec && sec.ingredients) || []).filter(function (i) { return i && String(i.amount == null ? "" : i.amount).trim() && i.name; });
      ((sec && sec.steps) || []).forEach(function (st, sti) {
        var text = typeof st === "string" ? st : (st && st.text) || "";
        if (/\d/.test(text)) return;                 // step already has a number
        var plain = String(text).replace(/\{[^}]+\}/g, " ").toLowerCase();
        measured.forEach(function (ing) {
          var name = String(ing.name).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
          if (name.length < 4) return;
          if (new RegExp("\\b" + escapeRe(name) + "\\b").test(plain)) {
            out.push({ section: si, step: sti, ingredient: ing.name, amount: ing.amount, unit: ing.unit || "" });
          }
        });
      });
    });
    return out.slice(0, 12);
  }

  // Canonical signature of every ingredient (amount | unit | name). Must be
  // identical before and after an AI cleanup — cleanup may only touch step/notes
  // TEXT, never an ingredient's quantity, unit, or name.
  function ingredientSignature(recipe) {
    return ((recipe && recipe.sections) || []).map(function (sec) {
      return (((sec && sec.ingredients) || [])).map(function (i) {
        return [String((i && i.amount) == null ? "" : i.amount).trim(),
                String((i && i.unit) || "").toLowerCase().trim(),
                normalizeText(String((i && i.name) || "")).toLowerCase()].join("|");
      }).join(";");
    }).join("||");
  }
  // The cleanup guard: accept the AI's result ONLY if it preserved every
  // ingredient and the section/step counts (i.e. it edited only text). Any change
  // to a quantity, unit, ingredient, or structure -> reject and keep the
  // deterministic recipe. This is what makes Stage 3 safe.
  function cleanupPreservedRecipe(original, cleaned) {
    if (!original || !cleaned || !Array.isArray(cleaned.sections)) return false;
    if (ingredientSignature(original) !== ingredientSignature(cleaned)) return false;
    var o = original.sections || [], c = cleaned.sections || [];
    if (o.length !== c.length) return false;
    for (var i = 0; i < o.length; i++) {
      if (((o[i].ingredients) || []).length !== ((c[i].ingredients) || []).length) return false;
      if (((o[i].steps) || []).length !== ((c[i].steps) || []).length) return false;
    }
    return true;
  }

  return {
    normalizeText: normalizeText,
    normalizeFractions: normalizeFractions,
    fixTypos: fixTypos,
    normalizeIngredient: normalizeIngredient,
    normalizeRecipe: normalizeRecipe,
    quantityAwareDirections: quantityAwareDirections,
    convertTempsInText: convertTempsInText,
    convertMeasuresInText: convertMeasuresInText,
    gramsToUsWeight: gramsToUsWeight,
    mlToUsVolume: mlToUsVolume,
    localizeTerms: localizeTerms,
    localizeIngredientName: localizeIngredientName,
    localizeText: localizeText,
    precedingMeasureMatches: precedingMeasureMatches,
    auditRecipe: auditRecipe,
    duplicateIngredientRows: duplicateIngredientRows,
    qualityScore: qualityScore,
    missingDirectionQuantities: missingDirectionQuantities,
    ingredientSignature: ingredientSignature,
    cleanupPreservedRecipe: cleanupPreservedRecipe,
    COMMON_TYPOS: COMMON_TYPOS,
  };
});
