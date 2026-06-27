(function (root) {
  // RecipeBox tag helpers — shared by the browser app and Node tests.
  // Tags are a per-recipe array (stored in recipe_json). No global tag table.
  const MAX_TAGS = 12;

  // Canonical display names, keyed by normalized key (see normalizeTagKey).
  // Hyphens and spaces are treated the same for matching, so "gluten free"
  // and "gluten-free" both resolve to "Gluten-Free".
  const CANONICAL = {
    "copycat": "Copycat",
    "restaurant style": "Copycat",
    "quick": "Quick",
    "weeknight": "Weeknight",
    "kid friendly": "Kid-Friendly",
    "meal prep": "Meal Prep",
    "freezer friendly": "Freezer-Friendly",
    "one pot": "One-Pot",
    "one pan": "One-Pot",
    "sheet pan": "One-Pot",
    "slow cooker": "Slow Cooker",
    "crock pot": "Slow Cooker",
    "instant pot": "Instant Pot",
    "pressure cooker": "Instant Pot",
    "air fryer": "Air Fryer",
    "grill": "Grill",
    "grilled": "Grill",
    "no bake": "No-Bake",
    "make ahead": "Make-Ahead",
    "high protein": "High-Protein",
    "low carb": "Low-Carb",
    "vegetarian": "Vegetarian",
    "vegan": "Vegan",
    "gluten free": "Gluten-Free",
    "dairy free": "Dairy-Free",
    "spicy": "Spicy",
    "comfort food": "Comfort Food",
    "holiday": "Holiday",
    "party": "Party",
    "budget friendly": "Budget-Friendly",
  };

  // A case-insensitive, punctuation-insensitive key used for de-duplication
  // and canonical lookup. "CopyCat", "copy-cat", "copycat" -> "copycat".
  function normalizeTagKey(tag) {
    return String(tag == null ? "" : tag)
      .toLowerCase()
      .replace(/[_/]+/g, " ")
      .replace(/-+/g, " ")
      .replace(/[^a-z0-9 &']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function titleCase(str) {
    return String(str)
      .split(" ")
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(" ");
  }

  // The clean display form for a tag: canonical when known, otherwise the
  // user's text with light cleanup. We only re-case all-lowercase input so we
  // never mangle intentional casing or acronyms like "BBQ".
  function displayTag(tag) {
    const key = normalizeTagKey(tag);
    if (!key) return "";
    if (CANONICAL[key]) return CANONICAL[key];
    const cleaned = String(tag).replace(/\s+/g, " ").trim();
    if (cleaned && cleaned === cleaned.toLowerCase()) return titleCase(cleaned);
    return cleaned;
  }

  // De-duplicate (case-insensitively), normalize display, and cap the count.
  // Never throws; always returns an array.
  function normalizeRecipeTags(tags, options) {
    const max = (options && options.max) || MAX_TAGS;
    const seen = new Set();
    const out = [];
    const list = Array.isArray(tags) ? tags : [];
    for (const raw of list) {
      const key = normalizeTagKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(displayTag(raw));
      if (out.length >= max) break;
    }
    return out;
  }

  // Known restaurant/brand names. Used only together with an explicit
  // "style/inspired/copycat" modifier so we don't tag a generic recipe.
  const BRANDS = [
    "starbucks", "chick fil a", "chickfila", "olive garden", "crumbl", "panera",
    "mcdonald's", "mcdonalds", "chipotle", "taco bell", "kfc", "wendy's", "wendys",
    "in n out", "in-n-out", "cheesecake factory", "cracker barrel", "panda express",
    "raising cane's", "raising canes", "popeyes", "dunkin", "texas roadhouse",
    "outback", "applebee's", "applebees", "red lobster", "chili's", "chilis",
    "ihop", "wingstop", "five guys", "shake shack", "domino's", "dominos",
    "pizza hut", "subway", "arby's", "arbys", "dairy queen", "sonic", "whataburger",
    "culver's", "culvers", "jimmy john's", "qdoba", "jersey mike's", "auntie anne's",
    "cinnabon", "chick-fil-a", "panera bread", "trader joe's", "trader joes",
  ];

  function recipeText(recipe) {
    const r = recipe || {};
    let steps = "";
    let ingredients = "";
    (Array.isArray(r.sections) ? r.sections : []).forEach((s) => {
      (Array.isArray(s.steps) ? s.steps : []).forEach((st) => {
        steps += " " + (typeof st === "string" ? st : (st && st.text) || "");
      });
      (Array.isArray(s.ingredients) ? s.ingredients : []).forEach((i) => {
        ingredients += " " + (typeof i === "string" ? i : (i && i.name) || "");
      });
    });
    const existingTags = (Array.isArray(r.tags) ? r.tags : []).join(" ");
    // "signal" = where intent lives (title/tags/description/notes/source).
    const signal = [r.title, existingTags, r.description, r.notes, r.sourceUrl, r.source]
      .filter(Boolean).join(" ").toLowerCase();
    // "method" = direct evidence of cooking method (title + steps).
    const method = [r.title, steps].filter(Boolean).join(" ").toLowerCase();
    return { signal, method, ingredients: ingredients.toLowerCase() };
  }

  function parseMinutes(value) {
    if (value == null) return null;
    const str = String(value).toLowerCase();
    let minutes = 0;
    let matched = false;
    const h = str.match(/(\d+(?:\.\d+)?)\s*(h\b|hr|hour)/);
    if (h) { minutes += Math.round(parseFloat(h[1]) * 60); matched = true; }
    const m = str.match(/(\d+)\s*(m\b|min)/);
    if (m) { minutes += parseInt(m[1], 10); matched = true; }
    if (!matched) {
      const n = str.match(/^\s*(\d+)\s*$/);
      if (n) { minutes = parseInt(n[1], 10); matched = true; }
    }
    return matched ? minutes : null;
  }

  function totalMinutes(recipe) {
    const r = recipe || {};
    const total = parseMinutes(r.totalTime);
    if (total != null) return total;
    const prep = parseMinutes(r.prepTime);
    const cook = parseMinutes(r.cookTime);
    if (prep == null && cook == null) return null;
    return (prep || 0) + (cook || 0);
  }

  // Conservative, evidence-based tag suggestion. Returns canonical display
  // tags only when there is clear support. Never infers diet/allergy tags.
  function suggestTags(recipe) {
    const r = recipe || {};
    const { signal, method } = recipeText(r);
    const found = [];
    const add = (tag) => { if (found.indexOf(tag) === -1) found.push(tag); };

    // --- Copycat (restaurant recreation) ---
    const brandHit = BRANDS.some((b) => signal.indexOf(b) !== -1);
    if (
      /\bcopycat\b/.test(signal) ||
      /\brestaurant[-\s]?style\b/.test(signal) ||
      /\bbetter than take[-\s]?out\b/.test(signal) ||
      (brandHit && /(style|inspired|copycat|copy[-\s]?cat|knock[-\s]?off|dupe|at home|homemade)/.test(signal))
    ) {
      add("Copycat");
    }

    // --- Cooking method (direct evidence from title/steps) ---
    if (/\bair[-\s]?fry(?:er|ing)?\b/.test(method)) add("Air Fryer");
    if (/\bslow[-\s]?cooker\b|\bcrock[-\s]?pot\b/.test(method)) add("Slow Cooker");
    if (/\binstant[-\s]?pot\b|\bpressure[-\s]?cooker?\b/.test(method)) add("Instant Pot");
    if (/\bone[-\s]?pot\b|\bone[-\s]?pan\b|\bsheet[-\s]?pan\b/.test(method)) add("One-Pot");
    if (/\bno[-\s]?bake\b/.test(method)) add("No-Bake");
    if (/\bgrill(?:ed|ing)?\b/.test(method)) add("Grill");

    // --- Time-based ---
    const minutes = totalMinutes(r);
    const fast = (minutes != null && minutes > 0 && minutes <= 30) ||
      /\bquick\b|\beasy\b|\b(?:15|20|25|30)[-\s]?minute/.test(signal);
    if (fast) add("Quick");
    if (/\bweeknight\b/.test(signal) || (minutes != null && minutes > 0 && minutes <= 30)) add("Weeknight");

    // --- Wording-based collections (strong phrasing only) ---
    if (/\bcomfort food\b/.test(signal)) add("Comfort Food");
    if (/\b(christmas|thanksgiving|easter|hanukkah|halloween|holiday)\b/.test(signal)) add("Holiday");
    if (/\bparty\b|\bgame[-\s]?day\b/.test(signal)) add("Party");
    if (/\bbudget\b|\bfrugal\b|\bcheap\b/.test(signal)) add("Budget-Friendly");
    if (/\bkid[-\s]?friendly\b|\bfor kids\b/.test(signal)) add("Kid-Friendly");
    if (/\bmeal[-\s]?prep\b/.test(signal)) add("Meal Prep");
    if (/\bmake[-\s]?ahead\b/.test(signal)) add("Make-Ahead");
    if (/\bfreezer[-\s]?friendly\b|\bcan be frozen\b|\bfreeze (?:for|up to|well|ahead)\b/.test(signal)) add("Freezer-Friendly");
    if (/\bspicy\b/.test(signal)) add("Spicy");

    // --- Diet / health: explicit statements ONLY (never inferred) ---
    if (/\bvegetarian\b/.test(signal)) add("Vegetarian");
    if (/\bvegan\b/.test(signal)) add("Vegan");
    if (/\bgluten[-\s]?free\b/.test(signal)) add("Gluten-Free");
    if (/\bdairy[-\s]?free\b/.test(signal)) add("Dairy-Free");
    if (/\bhigh[-\s]?protein\b/.test(signal)) add("High-Protein");
    if (/\blow[-\s]?carb\b/.test(signal)) add("Low-Carb");

    return found;
  }

  // Merge a recipe's existing tags with conservative suggestions, then
  // normalize. User tags keep priority (placed first) and are never deleted.
  function applyTagsOnCreate(recipe) {
    const existing = Array.isArray(recipe && recipe.tags) ? recipe.tags : [];
    const suggested = suggestTags(recipe);
    return normalizeRecipeTags(existing.concat(suggested));
  }

  // Curated Smart Collections offered in the recipe-detail toggle UI. These are
  // tag-based, but the user has final say via collectionOverrides (below).
  var SMART_COLLECTIONS = [
    "Copycat", "Quick", "Weeknight", "Make-Ahead", "Meal Prep", "One-Pot",
    "Slow Cooker", "Instant Pot", "Air Fryer", "Grill", "No-Bake",
    "Comfort Food", "High-Protein", "Low-Carb", "Vegetarian", "Vegan",
    "Gluten-Free", "Dairy-Free", "Spicy", "Healthy",
  ];

  // Effective collection membership keys for a recipe AFTER manual overrides:
  // start from the (AI/tag) tags, drop user-excluded, add user-included. This is
  // the single source of truth for Quick Find / Smart Collection filtering.
  function collectionKeys(recipe) {
    var keys = new Set();
    ((recipe && recipe.tags) || []).forEach(function (t) { var k = normalizeTagKey(t); if (k) keys.add(k); });
    var ov = (recipe && recipe.collectionOverrides) || {};
    (Array.isArray(ov.exclude) ? ov.exclude : []).forEach(function (t) { keys.delete(normalizeTagKey(t)); });
    (Array.isArray(ov.include) ? ov.include : []).forEach(function (t) { var k = normalizeTagKey(t); if (k) keys.add(k); });
    return keys;
  }
  function recipeInCollection(recipe, collection) {
    var key = normalizeTagKey(collection);
    return !!key && collectionKeys(recipe).has(key);
  }

  // Compute the new collectionOverrides after the user toggles a collection on/off.
  // Manual choice beats AI tags; returning a collection to its tag default removes
  // the override (so future tag changes flow through again). Returns {} when there
  // are no overrides.
  function setCollectionMembership(recipe, collection, member) {
    var key = normalizeTagKey(collection);
    var ov = (recipe && recipe.collectionOverrides) || {};
    var include = new Set((Array.isArray(ov.include) ? ov.include : []).map(normalizeTagKey).filter(Boolean));
    var exclude = new Set((Array.isArray(ov.exclude) ? ov.exclude : []).map(normalizeTagKey).filter(Boolean));
    include.delete(key); exclude.delete(key);
    var taggedByDefault = ((recipe && recipe.tags) || []).map(normalizeTagKey).indexOf(key) !== -1;
    if (member && !taggedByDefault) include.add(key);
    else if (!member && taggedByDefault) exclude.add(key);
    var out = {};
    if (include.size) out.include = Array.from(include);
    if (exclude.size) out.exclude = Array.from(exclude);
    return out;
  }

  // Clean a collectionOverrides object from any source (load/import/sync). Returns
  // null when empty so we don't persist noise.
  function sanitizeCollectionOverrides(ov) {
    if (!ov || typeof ov !== "object" || Array.isArray(ov)) return null;
    var onlyStrings = function (a) { return (Array.isArray(a) ? a : []).filter(function (x) { return typeof x === "string"; }).map(normalizeTagKey).filter(Boolean); };
    var inc = Array.from(new Set(onlyStrings(ov.include)));
    var exc = Array.from(new Set(onlyStrings(ov.exclude)));
    if (!inc.length && !exc.length) return null;
    var out = {};
    if (inc.length) out.include = inc;
    if (exc.length) out.exclude = exc;
    return out;
  }

  const api = {
    MAX_TAGS,
    normalizeTagKey,
    displayTag,
    normalizeRecipeTags,
    suggestTags,
    applyTagsOnCreate,
    SMART_COLLECTIONS,
    collectionKeys,
    recipeInCollection,
    setCollectionMembership,
    sanitizeCollectionOverrides,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RecipeBoxTags = api;
})(typeof window !== "undefined" ? window : globalThis);
