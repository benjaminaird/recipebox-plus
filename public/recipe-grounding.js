/*
 * RecipeBoxGrounding — verify an AI-extracted recipe against its source text.
 *
 * The accuracy contract: imports must be faithful, so after an AI extraction (the
 * non-deterministic paths — blogs without structured data, pasted text, YouTube,
 * social) we check that what the model produced is actually grounded in the
 * source. Two failure modes matter:
 *   - hallucination / over-extraction: an extracted ingredient whose distinctive
 *     words never appear in the source (the model invented or substituted it).
 *   - distinctive drops: a high-signal ingredient that IS in the source but
 *     didn't make it into the recipe (e.g. half-and-half quietly became milk).
 *
 * Output is advisory (a confidence score + warnings + a needsReview flag), never
 * a silent edit — the UI surfaces it so the user can verify. Deterministic
 * (structured-data) imports skip this entirely; they're publisher-accurate.
 *
 * Pure: no DOM/network/AI. window.RecipeBoxGrounding + Node require for tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RecipeBoxGrounding = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Units, prep words, and filler that carry no identity — ignored when deciding
  // whether an ingredient is grounded.
  var STOPWORDS = new Set([
    "and", "or", "to", "of", "the", "for", "with", "into", "plus", "optional", "taste", "your",
    "fresh", "large", "small", "medium", "ripe", "about", "approximately", "room", "temperature",
    "cold", "warm", "hot", "finely", "coarsely", "roughly", "thinly", "chopped", "diced", "minced",
    "sliced", "grated", "shredded", "melted", "softened", "divided", "packed", "beaten", "drained",
    "rinsed", "cooked", "uncooked", "boneless", "skinless", "ground", "whole", "low", "reduced",
    "can", "cans", "package", "packages", "pkg", "cup", "cups", "tablespoon", "tablespoons", "tbsp",
    "teaspoon", "teaspoons", "tsp", "ounce", "ounces", "pound", "pounds", "lbs", "gram", "grams",
    "kilogram", "kilograms", "milliliter", "liter", "liters", "cloves", "clove", "stick", "sticks",
    "pinch", "dash", "slice", "slices", "piece", "pieces", "quart", "pint", "gallon", "handful",
    "sprig", "sprigs", "bunch", "container", "jar", "box", "bag",
  ]);

  function normalize(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/[-_/]+/g, " ")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Distinctive content words of an ingredient name (drop units/prep/fillers and
  // pure numbers). "2 cups all-purpose flour" -> ["all","purpose","flour"].
  function contentTokens(name) {
    return normalize(name).split(" ").filter(function (t) {
      return t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t);
    });
  }

  // An ingredient is grounded if any distinctive token (or a simple singular/
  // plural variant) appears in the source. Lenient by design — better to miss a
  // subtle drift than to nag about every synonym.
  function isGrounded(name, srcNorm) {
    var tokens = contentTokens(name);
    if (!tokens.length) return true; // nothing distinctive to verify
    return tokens.some(function (t) {
      if (srcNorm.indexOf(t) !== -1) return true;
      if (t.length > 4 && srcNorm.indexOf(t.replace(/s$/, "")) !== -1) return true;
      return srcNorm.indexOf(t + "s") !== -1;
    });
  }

  function ingredientNames(recipe) {
    var out = [];
    ((recipe && recipe.sections) || []).forEach(function (sec) {
      ((sec && sec.ingredients) || []).forEach(function (i) {
        var n = (i && (i.name || i.raw)) || "";
        if (n) out.push(n);
      });
    });
    return out;
  }

  // Coverage of extracted ingredients that are grounded in the source text.
  // When there's no source text (e.g. a photo import), grounding can't be judged,
  // so coverage is reported as 1 (no false alarms) with checkable:false.
  function groundRecipe(recipe, sourceText) {
    var names = ingredientNames(recipe);
    var src = normalize(sourceText);
    if (!src || !names.length) {
      return { checkable: false, coverage: 1, total: names.length, grounded: names.length, ungrounded: [] };
    }
    var ungrounded = names.filter(function (n) { return !isGrounded(n, src); });
    var grounded = names.length - ungrounded.length;
    return {
      checkable: true,
      coverage: names.length ? grounded / names.length : 1,
      total: names.length,
      grounded: grounded,
      ungrounded: ungrounded,
    };
  }

  // High-signal ingredients whose identity changes the dish, so a silent
  // substitution (source has it, recipe doesn't) is worth flagging.
  var DISTINCTIVE = [
    "half and half", "heavy cream", "buttermilk", "whole milk", "evaporated milk", "condensed milk",
    "sour cream", "cream cheese", "mascarpone", "ricotta", "creme fraiche",
    "brown sugar", "powdered sugar", "molasses", "honey", "maple syrup", "corn syrup",
    "bread flour", "cake flour", "almond flour", "cornstarch", "cornmeal",
    "baking soda", "baking powder", "cream of tartar", "active dry yeast",
    "dark chocolate", "white chocolate", "cocoa powder", "espresso",
    "coconut milk", "fish sauce", "oyster sauce", "soy sauce", "rice vinegar", "sesame oil",
    "smoked paprika", "cumin", "coriander", "cardamom", "saffron", "nutmeg",
    "scallions", "shallots", "leeks", "cilantro", "parsley", "basil",
  ];

  // Distinctive ingredients clearly named in the source but missing from the
  // recipe (likely a silent AI substitution / drop).
  function droppedDistinctive(recipe, sourceText) {
    var src = normalize(sourceText);
    if (!src) return [];
    var ing = normalize(ingredientNames(recipe).join(" "));
    var out = [];
    DISTINCTIVE.forEach(function (term) {
      var t = normalize(term);
      if (src.indexOf(t) !== -1 && ing.indexOf(t) === -1) out.push(term);
    });
    return out.slice(0, 5);
  }

  // Combined verdict for an import. confidence in [0,1]; needsReview true when the
  // recipe looks materially off the source. Advisory only.
  function verifyImport(recipe, sourceText, opts) {
    opts = opts || {};
    var minCoverage = opts.minCoverage != null ? opts.minCoverage : 0.75;
    var g = groundRecipe(recipe, sourceText);
    var dropped = droppedDistinctive(recipe, sourceText);
    var warnings = [];
    if (g.checkable && g.ungrounded.length) {
      warnings.push("These may not be in the original recipe: " + g.ungrounded.slice(0, 5).join(", ") + ".");
    }
    if (dropped.length) {
      warnings.push("The source mentions " + dropped.join(", ") + " — make sure the ingredients match.");
    }
    var needsReview = (g.checkable && g.coverage < minCoverage) || dropped.length > 0;
    return {
      confidence: Math.round(g.coverage * 100) / 100,
      checkable: g.checkable,
      total: g.total,
      grounded: g.grounded,
      ungrounded: g.ungrounded,
      dropped: dropped,
      warnings: warnings,
      needsReview: needsReview,
    };
  }

  return {
    normalize: normalize,
    contentTokens: contentTokens,
    isGrounded: isGrounded,
    ingredientNames: ingredientNames,
    groundRecipe: groundRecipe,
    droppedDistinctive: droppedDistinctive,
    verifyImport: verifyImport,
    DISTINCTIVE: DISTINCTIVE,
  };
});
