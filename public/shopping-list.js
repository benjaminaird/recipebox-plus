(function (root) {
  const VOLUME_TO_TSP = {
    tsp: 1, teaspoon: 1, teaspoons: 1,
    tbsp: 3, tablespoon: 3, tablespoons: 3,
    cup: 48, cups: 48,
    pint: 96, pints: 96,
    quart: 192, quarts: 192,
    gallon: 768, gallons: 768,
  };
  const WEIGHT_TO_OZ = {
    oz: 1, ounce: 1, ounces: 1,
    lb: 16, lbs: 16, pound: 16, pounds: 16,
    g: 1 / 28.3495, gram: 1 / 28.3495, grams: 1 / 28.3495,
    kg: 1000 / 28.3495, kilogram: 1000 / 28.3495, kilograms: 1000 / 28.3495,
  };
  const COUNT_UNITS = new Set(["egg", "eggs", "lemon", "lemons", "package", "packages", "pkg", "pkgs", "can", "cans", "clove", "cloves", "stick", "sticks"]);
  const KNOWN_UNITS = new Set([...Object.keys(VOLUME_TO_TSP), ...Object.keys(WEIGHT_TO_OZ), ...COUNT_UNITS, "pinch", "pinches", "dash", "dashes"]);
  const MEASURE_DESCRIPTORS = new Set(["heaping", "scant", "level", "rounded", "generous", "packed"]);
  const PREP_WORDS = ["melted", "cubed", "softened", "chopped", "diced", "minced", "sliced", "divided", "beaten", "packed", "zested", "juiced", "room temperature"];
  const CATEGORY_ORDER = ["Produce", "Meat & Seafood", "Dairy & Eggs", "Bakery", "Baking", "Pantry", "Canned & Jarred", "Frozen", "Spices & Seasonings", "Beverages", "Household / Other", "Uncategorized"];

  function normalizeFractions(str) {
    return String(str || "")
      .replace(/¼/g, "1/4").replace(/½/g, "1/2").replace(/¾/g, "3/4")
      .replace(/⅓/g, "1/3").replace(/⅔/g, "2/3")
      .replace(/⅛/g, "1/8").replace(/⅜/g, "3/8").replace(/⅝/g, "5/8").replace(/⅞/g, "7/8");
  }

  function amountToNumber(amount) {
    const raw = normalizeFractions(amount).trim();
    if (!raw || /[()]/.test(raw)) return null;
    const mixed = raw.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    const frac = raw.match(/^(\d+)\/(\d+)$/);
    if (frac) return Number(frac[1]) / Number(frac[2]);
    return /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
  }

  function numberToFraction(n) {
    if (!isFinite(n)) return "";
    const whole = Math.floor(n);
    const frac = n - whole;
    const options = [[1 / 8, "1/8"], [1 / 4, "1/4"], [1 / 3, "1/3"], [3 / 8, "3/8"], [1 / 2, "1/2"], [5 / 8, "5/8"], [2 / 3, "2/3"], [3 / 4, "3/4"], [7 / 8, "7/8"]];
    let best = null;
    for (const [val, label] of options) if (Math.abs(frac - val) < 0.035) best = label;
    if (best) return whole > 0 ? whole + " " + best : best;
    const rounded = Math.round(n * 100) / 100;
    return rounded % 1 === 0 ? String(rounded) : String(rounded);
  }

  function titleCase(text) {
    return String(text || "").replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }

  function cleanUnit(unit) {
    const u = String(unit || "").toLowerCase().replace(/\./g, "").trim();
    const aliases = { t: "tsp", tsps: "tsp", tbl: "tbsp", tbls: "tbsp", tbs: "tbsp", tablespoons: "tbsp", tablespoon: "tbsp", teaspoons: "tsp", teaspoon: "tsp", cups: "cup", pounds: "lb", pound: "lb", lbs: "lb", ounces: "oz", ounce: "oz", grams: "g", gram: "g", kilograms: "kg", kilogram: "kg", packages: "package", pkgs: "package", pkg: "package", cans: "can", cloves: "clove", sticks: "stick", eggs: "egg", lemons: "lemon" };
    const descriptive = u.match(/^([a-z]+)\s+(.+)$/);
    if (descriptive && MEASURE_DESCRIPTORS.has(descriptive[1])) {
      const base = aliases[descriptive[2]] || descriptive[2];
      return descriptive[1] + " " + base;
    }
    return aliases[u] || u;
  }

  function isKnownUnit(unit) {
    const cleaned = cleanUnit(unit);
    const descriptive = cleaned.match(/^([a-z]+)\s+(.+)$/);
    if (descriptive && MEASURE_DESCRIPTORS.has(descriptive[1])) return KNOWN_UNITS.has(descriptive[2]);
    return KNOWN_UNITS.has(cleaned);
  }

  function removeDuplicateWords(text) {
    return String(text || "").replace(/\b([a-z]+)(\s+\1\b)+/gi, "$1");
  }

  function extractPrepNote(name) {
    let text = String(name || "");
    const notes = [];
    for (const word of PREP_WORDS) {
      const re = new RegExp("\\b" + word.replace(/\s+/g, "\\s+") + "\\b", "i");
      if (re.test(text)) {
        notes.push(word);
        text = text.replace(re, " ");
      }
    }
    text = text.replace(/\s*,\s*$/, " ").replace(/\s+/g, " ").trim();
    return { name: text, note: notes.join(", ") };
  }

  function normalizeIngredientName(name) {
    let text = removeDuplicateWords(String(name || "").toLowerCase())
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^\w\s&-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    text = text.replace(/\bconfectioners\b|\bconfectioner s\b/g, "powdered");
    text = text.replace(/\bpowdered sugar\b|\bpowdered powdered sugar\b/g, "powdered sugar");
    text = text.replace(/\bwhite sugar\b/g, "granulated sugar");
    text = text.replace(/\bplain flour\b/g, "all purpose flour");
    text = text.replace(/\ball-purpose\b/g, "all purpose");
    return text.trim();
  }

  function parseRawIngredient(line) {
    const raw = String(line || "").trim();
    const compound = normalizeFractions(raw).match(/^((?:(?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?)\s+[a-zA-Z]+(?:\s*\+\s*(?:(?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?)\s+[a-zA-Z]+)+)\s+(.+)$/);
    if (compound) return { amount: compound[1].trim(), unit: "", name: compound[2].trim() };
    const descriptiveMeasure = normalizeFractions(raw).match(/^((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?)\s+([a-z]+)\s+([a-zA-Z]+)\s+(.+)$/i);
    if (descriptiveMeasure && MEASURE_DESCRIPTORS.has(descriptiveMeasure[2].toLowerCase()) && isKnownUnit(descriptiveMeasure[3])) {
      return { amount: descriptiveMeasure[1] || "", unit: descriptiveMeasure[2] + " " + descriptiveMeasure[3], name: descriptiveMeasure[4].trim() };
    }
    const match = normalizeFractions(raw).match(/^((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s+(.+)$/);
    if (!match) return { amount: "", unit: "", name: raw };
    let unit = (match[2] || "").trim();
    let name = (match[3] || "").trim();
    const descriptive = name.match(/^([a-z]+)\s+([a-zA-Z]+)\s+(.+)$/i);
    if (unit && descriptive && MEASURE_DESCRIPTORS.has(descriptive[1].toLowerCase()) && isKnownUnit(descriptive[2])) {
      unit = unit + " " + descriptive[1] + " " + descriptive[2];
      name = descriptive[3].trim();
    }
    if (unit && !isKnownUnit(unit)) {
      name = (unit + " " + name).trim();
      unit = "";
    }
    return { amount: match[1] || "", unit, name };
  }

  function categorize(name, unit) {
    const n = " " + normalizeIngredientName(name) + " ";
    const u = cleanUnit(unit);
    if (/\b(lemon|lime|orange|apple|banana|berry|berries|onion|garlic|pepper|potato|tomato|lettuce|spinach|carrot|celery|zest|juice)\b/.test(n) && !/\bbottled\b/.test(n)) return "Produce";
    if (/\b(chicken|beef|pork|turkey|salmon|shrimp|fish|bacon|sausage)\b/.test(n)) return "Meat & Seafood";
    if (/\b(milk|cream|butter|cheese|yogurt|egg|eggs|buttermilk|sour cream)\b/.test(n) || u === "egg") return "Dairy & Eggs";
    if (/\b(bread|bun|buns|roll|rolls|tortilla|bagel|baguette)\b/.test(n)) return "Bakery";
    if (/\b(flour|sugar|cornstarch|baking powder|baking soda|vanilla extract|chocolate|cocoa|pecan|pecans|walnut|walnuts|yeast)\b/.test(n)) return "Baking";
    if (/\b(can|canned|jar|jarred|tomato paste|broth|stock|beans)\b/.test(n) || u === "can") return "Canned & Jarred";
    if (/\b(frozen|ice cream)\b/.test(n)) return "Frozen";
    if (/\b(salt|pepper|cinnamon|paprika|cumin|oregano|basil|thyme|spice|seasoning)\b/.test(n)) return "Spices & Seasonings";
    if (/\b(water|coffee|tea|juice|soda|wine|beer)\b/.test(n)) return "Beverages";
    if (/\b(foil|paper towel|parchment|soap|bag|bags)\b/.test(n)) return "Household / Other";
    if (n.trim()) return "Pantry";
    return "Uncategorized";
  }

  function butterCompatibilityName(name) {
    const n = normalizeIngredientName(name);
    if (!/\bbutter\b/.test(n)) return n;
    if (/\bunsalted\b/.test(n)) return "unsalted butter";
    if (/\bsalted\b/.test(n)) return "salted butter";
    return "butter";
  }

  function unitClass(unit) {
    const u = cleanUnit(unit);
    if (!u) return "none";
    if (/^(heaping|scant|level|rounded|generous|packed)\s+/.test(u)) return "unit:" + u;
    if (VOLUME_TO_TSP[u]) return "volume";
    if (WEIGHT_TO_OZ[u]) return "weight";
    if (COUNT_UNITS.has(u)) return "count:" + u;
    return "unit:" + u;
  }

  function unitBaseValue(amount, unit) {
    const n = amountToNumber(amount);
    if (n === null) return null;
    const u = cleanUnit(unit);
    if (!u) return n;
    if (/^(heaping|scant|level|rounded|generous|packed)\s+/.test(u)) return null;
    if (VOLUME_TO_TSP[u]) return n * VOLUME_TO_TSP[u];
    if (WEIGHT_TO_OZ[u]) return n * WEIGHT_TO_OZ[u];
    if (COUNT_UNITS.has(u)) return n;
    return n;
  }

  function displayCombinedAmount(total, unitClassValue, preferredUnit) {
    if (unitClassValue === "volume") {
      if (total >= 48 && Math.abs(total / 48 - Math.round(total / 48)) < 0.001) return { amount: numberToFraction(total / 48), unit: total === 48 ? "cup" : "cups" };
      if (total >= 48) return { amount: numberToFraction(total / 48), unit: "cups" };
      if (total >= 12) return { amount: numberToFraction(total / 48), unit: "cup" };
      if (total >= 3 && Math.abs(total / 3 - Math.round(total / 3)) < 0.001) return { amount: numberToFraction(total / 3), unit: total === 3 ? "tbsp" : "tbsp" };
      return { amount: numberToFraction(total), unit: "tsp" };
    }
    if (unitClassValue === "weight") {
      if (total >= 16 && Math.abs(total / 16 - Math.round(total / 16)) < 0.001) return { amount: numberToFraction(total / 16), unit: total === 16 ? "lb" : "lb" };
      return { amount: numberToFraction(total), unit: "oz" };
    }
    return { amount: numberToFraction(total), unit: cleanUnit(preferredUnit) || preferredUnit || "" };
  }

  function parseShoppingIngredient(ingredient, sectionName) {
    const base = typeof ingredient === "string" ? parseRawIngredient(ingredient) : { ...ingredient };
    const rawText = base.raw_text || base.rawText || [base.amount, base.unit, base.name].filter(Boolean).join(" ").trim();
    const parsed = !base.name && rawText ? parseRawIngredient(rawText) : base;
    if (parsed.unit && !isKnownUnit(parsed.unit)) {
      parsed.name = (parsed.unit + " " + (parsed.name || "")).trim();
      parsed.unit = "";
    }
    const prep = extractPrepNote(parsed.name || "");
    const normalized = normalizeIngredientName(prep.name);
    const displayName = titleCase(removeDuplicateWords(prep.name || parsed.name || rawText));
    const category = parsed.category || categorize(displayName, parsed.unit);
    return {
      raw_text: rawText,
      quantity: parsed.quantity ?? parsed.amount ?? "",
      unit: parsed.unit || "",
      normalized_ingredient_name: normalized,
      display_name: displayName,
      preparation_note: parsed.preparation_note || parsed.preparationNote || prep.note || "",
      section: sectionName || parsed.section || "",
      category,
      // Source recipe context (id + title), threaded through so a combined item
      // can show which recipes it came from. Original text stays in raw_text.
      source: (base && typeof base === "object" && base.source) || null,
      confidence: parsed.confidence ?? (normalized ? 0.78 : 0.35),
    };
  }

  // Unique source recipes that contributed to a set of parsed parts.
  function uniqueSources(parts) {
    const byId = new Map();
    (parts || []).forEach((part) => {
      const src = part && part.source;
      if (src && src.id != null && !byId.has(src.id)) byId.set(src.id, { id: src.id, title: src.title || "" });
    });
    return Array.from(byId.values());
  }

  function shoppingLine(amount, unit, name, notes) {
    const bits = [amount, unit, name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return notes ? bits + " (" + notes + ")" : bits;
  }

  function buildShoppingListFromSections(sections, options) {
    const scale = Number(options && options.scale) || 1;
    const groups = new Map();
    (sections || []).forEach((section) => {
      const sectionName = section.name || section.title || "";
      (section.ingredients || []).forEach((ingredient) => {
        const parsed = parseShoppingIngredient(ingredient, sectionName);
        if (!parsed.display_name.trim()) return;
        const unit = cleanUnit(parsed.unit);
        const cls = unitClass(unit);
        const amountNumber = amountToNumber(parsed.quantity);
        const safeName = butterCompatibilityName(parsed.normalized_ingredient_name);
        const key = safeName + "|" + cls;
        if (!groups.has(key)) groups.set(key, { key, name: parsed.display_name, normalizedName: safeName, unit, unitClass: cls, category: parsed.category, parts: [], notes: new Set(), total: 0, canCombine: true });
        const group = groups.get(key);
        const baseValue = unitBaseValue(parsed.quantity, unit);
        if (parsed.preparation_note) group.notes.add(parsed.preparation_note);
        group.parts.push({ ...parsed, unit, amountNumber, baseValue, quantity: parsed.quantity });
        if (baseValue === null || amountNumber === null) group.canCombine = false;
        else group.total += baseValue * scale;
      });
    });

    const items = Array.from(groups.values()).flatMap((group, idx) => {
      const notes = Array.from(group.notes).join(", ");
      if (group.parts.length === 1) {
        const part = group.parts[0];
        const amount = amountToNumber(part.quantity) === null ? part.quantity : numberToFraction(amountToNumber(part.quantity) * scale);
        return [{ id: idx + "-" + group.normalizedName, text: shoppingLine(amount, part.unit, part.display_name, part.preparation_note), category: group.category, checked: false, parts: group.parts, combined: false }];
      }
      if (group.canCombine && group.unitClass && !group.unitClass.startsWith("unit:")) {
        const display = displayCombinedAmount(group.total, group.unitClass === "none" ? "none" : group.unitClass, group.unit);
        return [{ id: idx + "-" + group.normalizedName, text: shoppingLine(display.amount, display.unit, group.name, notes), category: group.category, checked: false, parts: group.parts, combined: true }];
      }
      return group.parts.map((part, partIdx) => ({
        id: idx + "-" + partIdx + "-" + group.normalizedName,
        text: shoppingLine(part.quantity, part.unit, part.display_name, part.preparation_note),
        category: part.category,
        checked: false,
        parts: [part],
        combined: false,
        warning: "Kept separate because quantities or units are ambiguous.",
      }));
    });

    // Attach which source recipes each (possibly combined) item came from.
    items.forEach((item) => {
      item.sources = uniqueSources(item.parts);
      item.sourceCount = item.sources.length;
    });

    return items.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.text.localeCompare(b.text));
  }

  function groupShoppingItemsByCategory(items) {
    const grouped = {};
    for (const item of items || []) {
      const category = item.category || "Uncategorized";
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(item);
    }
    return CATEGORY_ORDER.filter((category) => grouped[category]).map((category) => ({ category, items: grouped[category] }));
  }

  function enrichRecipeIngredients(recipe) {
    const next = { ...recipe, sections: (recipe.sections || []).map((section) => ({
      ...section,
      ingredients: (section.ingredients || []).map((ingredient) => {
        const parsed = parseShoppingIngredient(ingredient, section.name || section.title || "");
        return typeof ingredient === "object"
          ? { ...ingredient, ...parsed, amount: ingredient.amount ?? parsed.quantity, unit: ingredient.unit ?? parsed.unit, name: ingredient.name ?? parsed.display_name }
          : { amount: parsed.quantity, unit: parsed.unit, name: parsed.display_name, ...parsed };
      })
    })) };
    return next;
  }

  // Defensive coercion for persisted shopping-list state: a tampered or corrupt
  // localStorage value (valid JSON of the wrong type, e.g. recipeIds set to a
  // string) must never crash the UI. Always returns the full expected shape.
  function emptyShoppingList() { return { title: "", recipeIds: [], manualItems: [], checked: {}, removed: {}, edits: {} }; }
  function sanitizeShoppingList(value) {
    const base = emptyShoppingList();
    if (!value || typeof value !== "object" || Array.isArray(value)) return base;
    const arr = (x) => (Array.isArray(x) ? x : []);
    const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
    return {
      title: typeof value.title === "string" ? value.title : "",
      recipeIds: arr(value.recipeIds),
      manualItems: arr(value.manualItems).filter((m) => m && typeof m === "object"),
      checked: obj(value.checked),
      removed: obj(value.removed),
      edits: obj(value.edits),
    };
  }
  function sanitizePantry(value) {
    return Array.isArray(value) ? value.filter((x) => typeof x === "string") : [];
  }

  // Group adjacent ingredients that are the SAME ingredient split into two
  // different-unit measures (e.g. "1/3 cup" + "3 Tbsp" granulated sugar) so a card
  // can render them on one line as "1/3 cup + 3 Tbsp granulated sugar". Display-
  // only: returns groups of the original ingredient objects, which stay intact so
  // scaling, the shopping list, and the editor are unaffected. Conservative —
  // only merges same normalized name + both measured + DIFFERENT units (two
  // separate listings of the same unit are left alone).
  function groupCompoundIngredients(ingredients) {
    const out = [];
    (Array.isArray(ingredients) ? ingredients : []).forEach((ing) => {
      if (!ing || typeof ing !== "object") { out.push({ name: (ing && ing.name) || "", items: [ing] }); return; }
      const last = out[out.length - 1];
      const prev = last && last.items[last.items.length - 1];
      const prevName = prev ? normalizeIngredientName(prev.name || "") : "";
      const thisName = normalizeIngredientName(ing.name || "");
      const sameName = !!prevName && prevName === thisName;
      const differentUnit = prev && String(prev.unit || "").toLowerCase().trim() !== String(ing.unit || "").toLowerCase().trim();
      const bothMeasured = prev && String(prev.amount || "").trim() && String(ing.amount || "").trim();
      if (sameName && differentUnit && bothMeasured) last.items.push(ing);
      else out.push({ name: ing.name || "", items: [ing] });
    });
    return out;
  }

  const api = { CATEGORY_ORDER, amountToNumber, numberToFraction, normalizeIngredientName, parseShoppingIngredient, buildShoppingListFromSections, groupShoppingItemsByCategory, enrichRecipeIngredients, emptyShoppingList, sanitizeShoppingList, sanitizePantry, groupCompoundIngredients };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RecipeBoxShopping = api;
})(typeof window !== "undefined" ? window : globalThis);
