/*
 * RecipeBoxExtract — deterministic, AI-free recipe extraction from web pages.
 *
 * The accuracy strategy is "structured data first": most recipe sites embed a
 * schema.org/Recipe object as JSON-LD (WP Recipe Maker, Tasty Recipes, NYT,
 * Serious Eats, AllRecipes, Food Network, …). When that data is present we map it
 * straight to the RecipeBox shape with NO model in the loop — as accurate as the
 * publisher's own data, instant, and free. Microdata (itemprop / h-recipe) is a
 * second deterministic tier. Only when neither is usable does the caller fall
 * back to AI.
 *
 * Everything here is pure (string in -> object out): no DOM, no network, no AI.
 * Loaded as window.RecipeBoxExtract and require()-able in Node for the offline
 * benchmark (scripts/import-extract-test.js).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RecipeBoxExtract = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- small text helpers -------------------------------------------------

  var NAMED_ENTITIES = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", deg: "°",
    frac12: "1/2", frac14: "1/4", frac34: "3/4", frac13: "1/3", frac23: "2/3",
    frac18: "1/8", frac38: "3/8", frac58: "5/8", frac78: "7/8", hellip: "…",
    mdash: "—", ndash: "–", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"',
  };
  function decodeEntities(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return cp(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return cp(parseInt(d, 10)); })
      .replace(/&([a-z0-9]+);/gi, function (m, name) {
        var k = name.toLowerCase();
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, k) ? NAMED_ENTITIES[k] : m;
      });
  }
  function cp(n) {
    if (!isFinite(n)) return "";
    try { return String.fromCodePoint(n); } catch (e) { return ""; }
  }
  // Unicode vulgar fractions -> ASCII, so quantities parse consistently.
  function normalizeFractions(s) {
    return String(s == null ? "" : s)
      .replace(/¼/g, "1/4").replace(/½/g, "1/2").replace(/¾/g, "3/4")
      .replace(/⅓/g, "1/3").replace(/⅔/g, "2/3")
      .replace(/⅛/g, "1/8").replace(/⅜/g, "3/8").replace(/⅝/g, "5/8").replace(/⅞/g, "7/8");
  }
  function stripHtml(s) {
    return decodeEntities(String(s == null ? "" : s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  }
  function clean(s) {
    return decodeEntities(normalizeFractions(String(s == null ? "" : s))).replace(/\s+/g, " ").trim();
  }
  function asArray(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }

  // ---- JSON-LD parsing ----------------------------------------------------

  // Pull every <script type="application/ld+json"> block and JSON.parse it.
  // Tolerant of CDATA wrappers, HTML-escaped quotes, and trailing junk.
  function parseJsonLdBlocks(html) {
    var out = [];
    var re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    var m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var raw = m[1].trim().replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
      var parsed = tryParse(raw);
      if (parsed == null && /&quot;|&amp;/.test(raw)) parsed = tryParse(decodeEntities(raw));
      if (parsed != null) out.push(parsed);
    }
    return out;
  }
  function tryParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  function typeMatches(node, want) {
    var t = node && node["@type"];
    if (t == null) return false;
    var list = asArray(t).map(function (x) { return String(x).toLowerCase(); });
    return list.indexOf(want.toLowerCase()) !== -1;
  }

  // Walk arbitrarily-nested JSON-LD (@graph, mainEntity, arrays) and return the
  // first node whose @type includes "Recipe".
  function findRecipeNode(nodes) {
    var found = null;
    function walk(n) {
      if (found || n == null) return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (typeof n === "object") {
        if (typeMatches(n, "Recipe")) { found = n; return; }
        if (n["@graph"]) walk(n["@graph"]);
        if (n.mainEntity) walk(n.mainEntity);
        if (n.mainEntityOfPage && typeof n.mainEntityOfPage === "object") walk(n.mainEntityOfPage);
      }
    }
    walk(nodes);
    return found;
  }

  // ---- field mappers ------------------------------------------------------

  // ISO-8601 duration ("PT1H30M") -> { minutes, display }.
  function parseISODuration(iso) {
    if (iso == null) return null;
    var s = String(iso).trim().toUpperCase();
    var m = s.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return null;
    var minutes = (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) + Math.round(Number(m[4] || 0) / 60);
    if (!minutes) return null;
    var h = Math.floor(minutes / 60), mm = minutes % 60, parts = [];
    if (h) parts.push(h + " hr");
    if (mm) parts.push(mm + " min");
    return { minutes: minutes, display: parts.join(" ") || (minutes + " min") };
  }

  // recipeYield can be a number, "4", "4 servings", "1 loaf (12 slices)",
  // "2 dozen cookies", or an array of those. Parse a USEFUL serving count:
  // prefer an explicit slice/serving count, expand "dozen", and decline a bare
  // "1 loaf/cake/pie" (which isn't really 1 serving) rather than mislead the
  // scaler — better to leave servings unset than assert "1 serving".
  var WHOLE_ITEM = /\b(loaf|loaves|cake|pie|tart|pan|dish|casserole|bundt|round|pizza|crust|sheet)\b/i;
  function parseYield(y) {
    var vals = asArray(y);
    // 1) An explicit count of servings/slices/pieces wins (e.g. "1 loaf (12 slices)").
    for (var i = 0; i < vals.length; i++) {
      var p = String(vals[i] == null ? "" : vals[i]).match(/\(?\b(\d+)\s*(?:slices|servings?|pieces|portions|bars|cookies|muffins|squares)\b/i);
      if (p) { var pn = Number(p[1]); if (pn > 0) return pn; }
    }
    // 2) "dozen" -> x12.
    for (var j = 0; j < vals.length; j++) {
      var dz = String(vals[j] == null ? "" : vals[j]).toLowerCase().match(/(\d+(?:\.\d+)?)?\s*dozen/);
      if (dz) { var d = dz[1] ? Number(dz[1]) : 1; if (d > 0) return Math.round(d * 12); }
    }
    // 3) Leading/explicit number, skipping a misleading bare "1 loaf/cake/…".
    for (var k = 0; k < vals.length; k++) {
      var v = vals[k];
      if (typeof v === "number" && isFinite(v) && v > 0) return Math.round(v);
      var s = String(v == null ? "" : v);
      var m = s.match(/\d+/);
      if (m) { var n = Number(m[0]); if (n > 0) { if (n === 1 && WHOLE_ITEM.test(s)) continue; return n; } }
    }
    return null;
  }

  function firstImageUrl(image) {
    var vals = asArray(image);
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      if (typeof v === "string" && v) return v;
      if (v && typeof v === "object" && typeof v.url === "string" && v.url) return v.url;
    }
    return "";
  }

  // Deterministic ingredient split: leading quantity + optional known unit + name.
  // Conservative — when unsure it keeps the whole thing as the name (never drops
  // or invents text). Mirrors the app's import shape {id,amount,unit,name}.
  var KNOWN_UNITS = {
    tsp: 1, teaspoon: 1, teaspoons: 1, t: 1,
    tbsp: 1, tablespoon: 1, tablespoons: 1, tbs: 1, tbl: 1, tbls: 1,
    cup: 1, cups: 1, c: 1, pint: 1, pints: 1, quart: 1, quarts: 1, qt: 1,
    gallon: 1, gallons: 1, gal: 1, oz: 1, ounce: 1, ounces: 1, lb: 1, lbs: 1,
    pound: 1, pounds: 1, g: 1, gram: 1, grams: 1, kg: 1, kilogram: 1, kilograms: 1,
    ml: 1, milliliter: 1, milliliters: 1, l: 1, liter: 1, liters: 1, litre: 1, litres: 1,
    clove: 1, cloves: 1, can: 1, cans: 1, package: 1, packages: 1, pkg: 1, stick: 1,
    sticks: 1, pinch: 1, pinches: 1, dash: 1, dashes: 1, slice: 1, slices: 1,
    sprig: 1, sprigs: 1, handful: 1, piece: 1, pieces: 1,
  };
  var QTY = "(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)";
  function parseIngredientLine(line) {
    var raw = clean(line);
    if (!raw) return { amount: "", unit: "", name: "", raw: "" };
    // amount may be a range ("1 to 2", "1-2") — keep it as written in `amount`.
    var m = raw.match(new RegExp("^(" + QTY + "(?:\\s*(?:-|–|to)\\s*" + QTY + ")?)\\s+(.*)$"));
    if (!m) return { amount: "", unit: "", name: raw, raw: raw };
    var amount = m[1].trim();
    var rest = m[2].trim();
    var unit = "";
    var um = rest.match(/^([a-zA-Z]+)\.?\s+(.*)$/);
    if (um && Object.prototype.hasOwnProperty.call(KNOWN_UNITS, um[1].toLowerCase())) {
      unit = um[1].toLowerCase();
      rest = um[2].trim();
    }
    return { amount: amount, unit: unit, name: rest, raw: raw };
  }

  function ingredientsFrom(node) {
    var lines = asArray(node.recipeIngredient).length ? asArray(node.recipeIngredient) : asArray(node.ingredients);
    var out = [];
    lines.forEach(function (line, i) {
      var text = typeof line === "string" ? line : (line && line.text) || "";
      var p = parseIngredientLine(text);
      if (p.name || p.raw) out.push({ id: "i" + (i + 1), amount: p.amount, unit: p.unit, name: p.name, raw: p.raw });
    });
    return out;
  }

  // recipeInstructions can be: a string (often newline/period separated), an array
  // of strings, an array of HowToStep {text}, or HowToSection {itemListElement:[...]}.
  // Returns a flat list of sections: [{ name, steps:[{id,text,ingredientRefs}] }].
  function instructionSectionsFrom(node) {
    var instr = node.recipeInstructions;
    var sections = [];
    var loose = []; // steps with no explicit section

    function pushStep(target, text) {
      var t = stripHtml(text);
      if (t) target.push(t);
    }
    function handle(item, target) {
      if (item == null) return;
      if (typeof item === "string") { pushStep(target, item); return; }
      if (Array.isArray(item)) { item.forEach(function (x) { handle(x, target); }); return; }
      if (typeof item === "object") {
        if (typeMatches(item, "HowToSection") || item.itemListElement) {
          var secSteps = [];
          asArray(item.itemListElement).forEach(function (x) { handle(x, secSteps); });
          if (secSteps.length) sections.push({ name: clean(item.name || ""), steps: secSteps });
          return;
        }
        if (item.text) { pushStep(target, item.text); return; }
        if (item.name) { pushStep(target, item.name); return; }
      }
    }

    if (typeof instr === "string") {
      // Split a single blob into sentence-ish steps.
      stripHtml(instr).split(/\r?\n+|(?<=[.!?])\s+(?=[A-Z0-9])/).forEach(function (s) {
        var t = s.trim(); if (t) loose.push(t);
      });
    } else {
      asArray(instr).forEach(function (x) { handle(x, loose); });
    }

    var result = [];
    if (loose.length) result.push({ name: "", steps: loose });
    sections.forEach(function (s) { result.push(s); });
    // Re-number into the RecipeBox step shape.
    var n = 0;
    return result.map(function (sec) {
      return {
        name: sec.name || "",
        steps: sec.steps.map(function (text) { n += 1; return { id: "s" + n, text: text, ingredientRefs: [] }; }),
      };
    });
  }

  function nutritionFrom(node) {
    var nu = node.nutrition;
    if (!nu || typeof nu !== "object") return null;
    function n(v) { if (v == null) return null; var m = String(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; }
    var out = {
      calories: n(nu.calories),
      protein: n(nu.proteinContent),
      carbs: n(nu.carbohydrateContent),
      fat: n(nu.fatContent),
      fiber: n(nu.fiberContent),
    };
    if (out.calories == null && out.protein == null && out.carbs == null && out.fat == null) return null;
    Object.keys(out).forEach(function (k) { if (out[k] == null) delete out[k]; if (out[k] < 0) out[k] = 0; });
    return out;
  }

  function tagsFrom(node) {
    var tags = [];
    ["recipeCategory", "recipeCuisine", "keywords"].forEach(function (key) {
      asArray(node[key]).forEach(function (v) {
        String(v == null ? "" : v).split(",").forEach(function (part) {
          var t = clean(part);
          if (t && t.length <= 30) tags.push(t);
        });
      });
    });
    // de-dupe case-insensitively
    var seen = {}, uniq = [];
    tags.forEach(function (t) { var k = t.toLowerCase(); if (!seen[k]) { seen[k] = 1; uniq.push(t); } });
    return uniq.slice(0, 12);
  }

  // ---- recipe assembly ----------------------------------------------------

  function recipeFromJsonLd(node, opts) {
    opts = opts || {};
    var title = clean(node.name);
    var ingredients = ingredientsFrom(node);
    var stepSections = instructionSectionsFrom(node);
    var stepCount = stepSections.reduce(function (a, s) { return a + s.steps.length; }, 0);

    // Build RecipeBox sections. Keep one ingredients block (RecipeBox keeps
    // ingredients + steps together per section; we attach all ingredients to the
    // first section and distribute steps across their named sections).
    var sections = [];
    if (stepSections.length <= 1) {
      sections.push({ name: "Main", ingredients: ingredients, steps: (stepSections[0] && stepSections[0].steps) || [] });
    } else {
      sections.push({ name: stepSections[0].name || "Main", ingredients: ingredients, steps: stepSections[0].steps });
      for (var i = 1; i < stepSections.length; i++) sections.push({ name: stepSections[i].name || ("Step " + (i + 1)), ingredients: [], steps: stepSections[i].steps });
    }

    var prep = parseISODuration(node.prepTime);
    var cook = parseISODuration(node.cookTime);
    var total = parseISODuration(node.totalTime);
    var recipe = {
      title: title,
      description: stripHtml(node.description || ""),
      servings: parseYield(node.recipeYield) || undefined,
      prepTime: prep ? prep.display : "",
      cookTime: cook ? cook.display : (total ? total.display : ""),
      totalTime: total ? total.display : "",
      heroImage: firstImageUrl(node.image),
      notes: "",
      tags: tagsFrom(node),
      sections: sections,
    };
    var macros = nutritionFrom(node);
    if (macros) recipe.macros = macros;
    // Drop undefined servings so callers/AI can fill it.
    if (recipe.servings == null) delete recipe.servings;

    var complete = !!(title && ingredients.length >= 2 && stepCount >= 1);
    return {
      recipe: recipe,
      source: "jsonld",
      complete: complete,
      fields: {
        title: !!title,
        servings: recipe.servings != null,
        ingredients: ingredients.length,
        steps: stepCount,
        image: !!recipe.heroImage,
        times: !!(recipe.prepTime || recipe.cookTime || recipe.totalTime),
        nutrition: !!macros,
      },
    };
  }

  // ---- microdata (itemprop) fallback -------------------------------------

  function extractMicrodata(html) {
    var s = String(html || "");
    if (!/itemtype=["'][^"']*schema.org\/Recipe/i.test(s) && !/itemprop=["']recipeIngredient["']/i.test(s)) return null;
    function collect(prop) {
      var out = [];
      var re = new RegExp("<([a-z0-9]+)[^>]*itemprop=[\"']" + prop + "[\"'][^>]*>([\\s\\S]*?)<\\/\\1>", "gi");
      var m;
      while ((m = re.exec(s)) !== null) {
        var content = m[0].match(/content=["']([^"']+)["']/i);
        out.push(clean(content ? content[1] : stripHtml(m[2])));
      }
      return out.filter(Boolean);
    }
    var name = collect("name")[0] || "";
    var ings = collect("recipeIngredient");
    if (!ings.length) ings = collect("ingredients");
    var steps = collect("recipeInstructions");
    if (!name && !ings.length) return null;
    var ingredients = ings.map(function (line, i) { var p = parseIngredientLine(line); return { id: "i" + (i + 1), amount: p.amount, unit: p.unit, name: p.name, raw: p.raw }; });
    var stepObjs = steps.map(function (text, i) { return { id: "s" + (i + 1), text: text, ingredientRefs: [] }; });
    var recipe = { title: name, description: "", heroImage: "", notes: "", tags: [], sections: [{ name: "Main", ingredients: ingredients, steps: stepObjs }] };
    var complete = !!(name && ingredients.length >= 2 && stepObjs.length >= 1);
    return { recipe: recipe, source: "microdata", complete: complete, fields: { title: !!name, ingredients: ingredients.length, steps: stepObjs.length } };
  }

  // ---- public entry -------------------------------------------------------

  // Try JSON-LD, then microdata. Returns a result object, or { recipe:null,
  // source:null, complete:false } when there's no usable structured data (the
  // signal for the caller to fall back to AI). Never invents content.
  function extractFromHtml(html, opts) {
    opts = opts || {};
    var nodes = parseJsonLdBlocks(html);
    var recipeNode = findRecipeNode(nodes);
    if (recipeNode) {
      var r = recipeFromJsonLd(recipeNode, opts);
      if (r.recipe.title || r.fields.ingredients) return r;
    }
    var md = extractMicrodata(html);
    if (md) return md;
    return { recipe: null, source: null, complete: false, fields: {} };
  }

  // Same, but from already-parsed JSON-LD nodes (the server already extracts
  // these for /api/fetch-url, so we can reuse them without re-scanning HTML).
  function extractFromJsonLdNodes(nodes, opts) {
    var node = findRecipeNode(nodes);
    if (!node) return { recipe: null, source: null, complete: false, fields: {} };
    var r = recipeFromJsonLd(node, opts || {});
    return (r.recipe.title || r.fields.ingredients) ? r : { recipe: null, source: null, complete: false, fields: {} };
  }

  return {
    extractFromHtml: extractFromHtml,
    extractFromJsonLdNodes: extractFromJsonLdNodes,
    parseJsonLdBlocks: parseJsonLdBlocks,
    findRecipeNode: findRecipeNode,
    recipeFromJsonLd: recipeFromJsonLd,
    extractMicrodata: extractMicrodata,
    parseIngredientLine: parseIngredientLine,
    parseISODuration: parseISODuration,
    parseYield: parseYield,
    decodeEntities: decodeEntities,
    stripHtml: stripHtml,
  };
});
