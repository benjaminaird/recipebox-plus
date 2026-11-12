// Turning recipes and planned meals into a shopping list.
//
// ## This does not reimplement the aggregation
//
// `packages/recipe-core/src/shopping-list.js` is the production algorithm and it is loaded here
// as itself, through Metro's watchFolders (see metro.config.js). It already
// answers every question the brief asks about what may be combined:
//
//   - It keys a group on the normalised ingredient name AND the unit class, so
//     a cup of flour and 100 g of flour land in different groups and are never
//     silently added together. Only a supported conversion combines them, and
//     volume-to-weight is not one without knowing the ingredient.
//   - If any part of a group has an amount it cannot parse -- "a pinch", "to
//     taste" -- the whole group is marked uncombinable and its parts are listed
//     separately, each carrying a warning that says why.
//   - Every item keeps `parts`, so the original wording, unit and preparation
//     note of each contributing line survive into the list.
//
// Reimplementing any of that would create a second answer to "is 1 cup of
// flour the same as 100 g of flour", and the two would diverge.
//
// ## What this module adds
//
// Two things the web module has no concept of.
//
// **Per-meal scale.** `buildShoppingListFromSections` takes one scale for the
// whole build, but a week's plan has a 2x roast on Thursday and a 1x dal on
// Friday. Calling it once per recipe would stop it combining ACROSS recipes,
// which is the entire point. So the amounts are scaled first and the module is
// then called once, at 1x, over everything.
//
// **Optional ingredients.** The brief is explicit that an optional ingredient
// must not be merged without the cook choosing. They are held out of the
// aggregation and listed separately, flagged, so "flaky sea salt, to finish
// (optional)" never silently increases the salt someone has to buy.
import {
  formatDecimalNumber, formatQuantity, parseQuantity, roundForUnit, roundMetricMeasure,
  scaleQuantity,
} from "./quantity.ts";
import { VOLUME_ML, WEIGHT_G, canonicalUnit, displayUnit, unitKind, unitSystem } from "./units.ts";
import type { Ingredient, Recipe, Section } from "../data/types.ts";

import { web } from "./webShoppingList.ts";

/** One line of a built list, as the web module returns it plus what we add. */
export type BuiltItem = {
  id: string;
  text: string;
  category: string;
  combined: boolean;
  /** Set by the web module when a group could not be safely combined. */
  warning?: string;
  /** Recipe titles that contributed to this line. */
  sources: string[];
  /** True when the line came from an ingredient marked optional. */
  optional: boolean;
};

/**
 * Render a metric line ourselves, or return null to keep the module's.
 *
 * The shared module decides *what may be combined*, and those decisions are
 * the valuable part. Its final formatting is US-centric, and on a metric
 * recipe it produces lines a cook cannot use:
 *
 *     250 g + 150 g butter   ->  "14 1/8 oz Butter"
 *     1.8 kg + 1.2 kg beef   ->  "105.82 oz Beef"
 *     3.6 kg chicken         ->  "3 5/8 kg Chicken"
 *
 * Ounces for someone shopping in grams, a vulgar fraction on a kilo, and two
 * decimal places of an ounce. That is production web behaviour and not ours to
 * change from here, so the native app re-renders the line instead -- using the
 * same rules Recipe Detail already uses, where metric takes decimals and a
 * weight is rounded to something a scale can read.
 *
 * Only for groups that are entirely metric and entirely one kind. Anything
 * else keeps the module's text, which is good at cups, spoons and their
 * laddering, and which we have no reason to second-guess.
 */
function metricLine(
  parts: ReadonlyArray<{ quantity?: string; unit?: string; display_name?: string }>,
): string | null {
  if (parts.length === 0) return null;
  const units = parts.map((p) => canonicalUnit(p.unit));
  if (!units.every((u) => unitSystem(u) === "metric")) return null;

  const kind = unitKind(units[0]);
  if (kind !== "weight" && kind !== "volume") return null;
  if (!units.every((u) => unitKind(u) === kind)) return null;

  const table: Record<string, number> = kind === "weight" ? WEIGHT_G : VOLUME_ML;

  let total = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const q = parseQuantity(parts[i].quantity);
    // A line we cannot read a number from must not be silently dropped out of
    // a total. Hand the whole group back to the module, which will keep the
    // parts apart and say why.
    if (q.kind !== "exact" && q.kind !== "range") return null;
    const value = q.kind === "range" ? q.max : q.value;
    const base = table[units[i]];
    if (!Number.isFinite(base)) return null;
    total += value * base;
  }

  // Climb to the larger unit only when there is enough to warrant it: 1200 g
  // is better read as 1.2 kg, 800 g is not better as 0.8 kg.
  const to = kind === "weight" ? (total >= 1000 ? "kg" : "g") : (total >= 1000 ? "L" : "ml");
  const value = total / table[to];
  const rounded = roundMetricMeasure(roundForUnit({ kind: "exact", value }, to), to);
  const amount = rounded.kind === "exact" ? formatDecimalNumber(rounded.value) : formatDecimalNumber(value);
  const name = parts[0].display_name ?? "";
  return [amount, displayUnit(to, Number(amount)), name].filter(Boolean).join(" ").trim();
}

/**
 * Metric volumes, which the shared module does not know are units.
 *
 * Its VOLUME_TO_TSP table holds teaspoons through gallons and **no metric
 * volume at all** -- no ml, no litre. An unrecognised unit is folded into the
 * ingredient's NAME, so "200 ml double cream" becomes an item called "Ml
 * Double Cream" with no unit, and "1 L stock" and "500 ml stock" become two
 * items that can never be combined because their names differ.
 *
 * That is production web behaviour and not ours to change from here. But two
 * of the sample recipes are metric and a cook with a metric library would get
 * exactly that, so the native app keeps these ingredients away from the module
 * and totals them itself, in millilitres, with the formatting rules this app
 * already uses everywhere else.
 */
const METRIC_VOLUMES: ReadonlySet<string> = new Set(["ml", "cl", "dl", "L"]);

function isMetricVolume(unit: string | undefined | null): boolean {
  return METRIC_VOLUMES.has(canonicalUnit(unit));
}

export type ListSource = {
  recipe: Recipe;
  /** The batch this recipe is being cooked at. From a planned meal, or 1. */
  scale: number;
};

/**
 * Multiply one ingredient's amount, leaving everything else alone.
 *
 * Unparseable amounts pass through untouched on purpose. "A pinch" doubled is
 * still a pinch, and writing "2 a pinch" would be worse than not scaling. The
 * aggregation downstream sees an unparseable amount and keeps that line
 * separate, which is the correct outcome.
 */
function scaleIngredient(ingredient: Ingredient, scale: number): Ingredient {
  if (scale === 1) return ingredient;
  const q = parseQuantity(ingredient.amount);
  if (q.kind === "opaque" || q.kind === "none") return ingredient;
  return { ...ingredient, amount: formatQuantity(scaleQuantity(q, scale)) };
}

function isOptional(ingredient: Ingredient): boolean {
  return ingredient.optional === true;
}

/**
 * Sections as the web module wants them: pre-scaled, optional lines removed,
 * and each ingredient tagged with the recipe it came from.
 *
 * The tag is what makes provenance work. `parseShoppingIngredient` threads an
 * ingredient's `source` through to the built item, and `uniqueSources` collects
 * them, so a combined line can say which recipes produced it. Without the tag
 * the module is perfectly happy and every line comes back with an empty source
 * list -- which is how this was first written, and why a cook would have seen
 * "3 cups plain flour" with no way to tell where the three came from.
 */
function requiredSections(source: ListSource): Section[] {
  const tag = { id: source.recipe.id, title: source.recipe.title };
  return (source.recipe.sections ?? []).map((section) => ({
    ...section,
    ingredients: section.ingredients
      .filter((i) => !isOptional(i) && !isMetricVolume(i.unit))
      .map((i) => ({ ...scaleIngredient(i, source.scale), source: tag })),
  }));
}

/**
 * Build a shopping list from recipes, each at its own batch.
 *
 * The result is a flat, aisle-ordered list. It is a snapshot: once built, the
 * items are stored and edited on their own, and changing a recipe afterwards
 * does not rewrite a list someone may already be shopping from.
 */
export function buildList(sources: readonly ListSource[]): BuiltItem[] {
  const sections: Section[] = [];
  for (const source of sources) sections.push(...requiredSections(source));

  const built: BuiltItem[] = web.buildShoppingListFromSections(sections, { scale: 1 }).map((item) => ({
    id: item.id,
    text: metricLine(item.parts ?? []) ?? item.text,
    category: item.category ?? "Uncategorized",
    combined: item.combined === true,
    ...(item.warning ? { warning: item.warning } : {}),
    // Titles, not ids: this is read by a cook, and the id is already the
    // link if a screen ever needs to navigate.
    sources: (item.sources ?? []).map((s) => s.title).filter(Boolean),
    optional: false,
  }));

  // Metric volumes, totalled here because the module cannot.
  //
  // Grouped on the same normalised name the module would use, so "double
  // cream" from two recipes is one line and "double cream" and "single cream"
  // are two -- the same judgement, applied by the same function.
  type VolumeGroup = {
    ml: number;
    name: string;
    category: string;
    sources: string[];
    readable: boolean;
  };
  const volumes = new Map<string, VolumeGroup>();

  for (const source of sources) {
    for (const section of source.recipe.sections ?? []) {
      for (const ingredient of section.ingredients) {
        if (isOptional(ingredient) || !isMetricVolume(ingredient.unit)) continue;
        const scaled = scaleIngredient(ingredient, source.scale);
        // Ask the module for the name and aisle, with the unit withheld so it
        // does not end up inside the name.
        const parsed = web.parseShoppingIngredient({ ...scaled, unit: "" }, section.name ?? "");
        const key = parsed.normalized_ingredient_name || parsed.display_name;
        const existing = volumes.get(key) ?? {
          ml: 0,
          name: parsed.display_name,
          category: parsed.category || "Uncategorized",
          sources: [],
          readable: true,
        };
        const q = parseQuantity(scaled.amount);
        if (q.kind === "exact" || q.kind === "range") {
          existing.ml += (q.kind === "range" ? q.max : q.value) * VOLUME_ML[canonicalUnit(scaled.unit)];
        } else {
          // An amount we cannot read must not quietly vanish from a total.
          existing.readable = false;
        }
        if (!existing.sources.includes(source.recipe.title)) existing.sources.push(source.recipe.title);
        volumes.set(key, existing);
      }
    }
  }

  for (const [key, group] of volumes) {
    const to = group.ml >= 1000 ? "L" : "ml";
    const value = group.ml / VOLUME_ML[to];
    const rounded = roundMetricMeasure(roundForUnit({ kind: "exact", value }, to), to);
    const amount = rounded.kind === "exact" ? formatDecimalNumber(rounded.value) : formatDecimalNumber(value);
    built.push({
      id: `vol-${key}`,
      text: [amount, displayUnit(to, Number(amount)), group.name].filter(Boolean).join(" ").trim(),
      category: group.category,
      combined: group.sources.length > 1,
      ...(group.readable
        ? {}
        : { warning: "One of these amounts could not be read, so this total may be short." }),
      sources: group.sources,
      optional: false,
    });
  }

  // Optional ingredients, appended one per line and never merged with anything.
  // Scaled like the rest, because half a batch wants half the garnish, but kept
  // out of every total so a cook is never told to buy more of something the
  // recipe said they could leave out.
  for (const source of sources) {
    for (const section of source.recipe.sections ?? []) {
      for (const ingredient of section.ingredients) {
        if (!isOptional(ingredient)) continue;
        const scaled = scaleIngredient(ingredient, source.scale);
        const text = [scaled.amount, scaled.unit, scaled.name].filter(Boolean).join(" ").trim();
        if (!text) continue;
        built.push({
          id: `optional-${source.recipe.id}-${ingredient.id}`,
          text,
          category: "Uncategorized",
          combined: false,
          sources: [source.recipe.title],
          optional: true,
        });
      }
    }
  }

  return built;
}

/** Aisle-ordered groups, as the web module orders them. */
export function groupByCategory(items: readonly { category: string }[]): string[] {
  const order: string[] = web.CATEGORY_ORDER ?? [];
  const present = new Set(items.map((i) => i.category));
  const known = order.filter((c) => present.has(c));
  const unknown = [...present].filter((c) => !order.includes(c)).sort();
  return [...known, ...unknown];
}

export const CATEGORY_ORDER: readonly string[] = web.CATEGORY_ORDER ?? [];

// ---------------------------------------------------------------------------
// A stored list
// ---------------------------------------------------------------------------

/**
 * Where a line came from, and what that means for rebuilding.
 *
 * `generated` lines are the output of the aggregation. They are owned by the
 * list's sources and are replaced wholesale when those sources change.
 *
 * `manual` lines are the cook's. They are never touched by a rebuild.
 *
 * **Editing a generated line adopts it**: it becomes `manual`. That one rule
 * removes an entire class of problem. Without it, a cook who corrects "3 cups
 * plain flour" to "1 bag of flour" would watch their correction vanish the
 * moment another recipe was added to the list, with nothing to explain why.
 */
export type ItemOrigin = "generated" | "manual";

export type ShoppingItem = {
  id: string;
  listId: string;
  text: string;
  category: string;
  checked: boolean;
  origin: ItemOrigin;
  optional: boolean;
  warning?: string;
  /** Recipe titles that contributed. Empty for a manual line. */
  sources: string[];
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type ShoppingListSource = { recipeId: string; title: string; scale: number };

export type ShoppingList = {
  id: string;
  title: string;
  sources: ShoppingListSource[];
  createdAt: number;
  updatedAt: number;
};

/**
 * Work out the new set of generated items for a list.
 *
 * Returns the items to keep as they are, the generated rows to replace, and
 * which of the replacements should start out ticked.
 *
 * Checked state survives a rebuild where the same line comes back. Someone who
 * has already put flour in the trolley and then adds another recipe should not
 * find flour un-ticked -- but if the amount CHANGED because the new recipe
 * needs more, the line is different and comes back unticked, which is correct:
 * they need to go and get more.
 */
export function reconcileGenerated(
  existing: readonly ShoppingItem[],
  rebuilt: readonly BuiltItem[],
): { keep: ShoppingItem[]; replaceWith: BuiltItem[]; checkedTexts: Set<string> } {
  const keep = existing.filter((i) => i.origin === "manual");
  const checkedTexts = new Set(
    existing.filter((i) => i.origin === "generated" && i.checked).map((i) => i.text),
  );
  return { keep, replaceWith: [...rebuilt], checkedTexts };
}

/** Items in the order a shop is walked: aisle, then within it, unchecked
 *  first so what is left to find stays at the top. */
export function sortForShopping(
  items: readonly ShoppingItem[],
  order: readonly string[] = CATEGORY_ORDER,
): ShoppingItem[] {
  const rank = (c: string) => {
    const i = order.indexOf(c);
    return i === -1 ? order.length : i;
  };
  return [...items].sort(
    (a, b) =>
      Number(a.checked) - Number(b.checked) ||
      rank(a.category) - rank(b.category) ||
      a.position - b.position ||
      a.text.localeCompare(b.text),
  );
}

/** How much of a list is done, for a progress line. */
export function listProgress(items: readonly ShoppingItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.checked).length, total: items.length };
}
