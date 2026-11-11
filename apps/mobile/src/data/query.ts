// Library search and filtering, as pure functions.
//
// Kept apart from db.ts on purpose: expo-sqlite cannot be imported by the
// node test runner, so the behaviour worth testing — what matches a search,
// what a filter admits, what order results come back in — lives here where
// tests can reach it, and db.ts only does storage.
// Explicit .ts extension: this module is loaded directly by `node --test`,
// where an extensionless specifier does not resolve. A type-only import is
// erased before that matters, but flattenSteps is a real value.
import { flattenSteps, type CookProgress, type Recipe } from "./types.ts";
import { detectSystem, openingMeasurement } from "../domain/present.ts";
import { hasTag, sameCategory } from "../domain/tags.ts";
import type { Measurement } from "../domain/convert.ts";

/**
 * The text a recipe is searchable by: its title, description, category, tags
 * and every ingredient name. Lowercased once at write time and stored, so a
 * keystroke never walks the whole library.
 */
export function buildSearchText(recipe: Recipe): string {
  const parts: string[] = [recipe.title];
  if (recipe.description) parts.push(recipe.description);
  if (recipe.category) parts.push(recipe.category);
  for (const tag of recipe.tags ?? []) parts.push(tag);
  for (const section of recipe.sections) {
    if (section.name) parts.push(section.name);
    for (const ingredient of section.ingredients) parts.push(ingredient.name);
  }
  return parts.join(" ").toLowerCase();
}

export type LibraryFilters = {
  /** Free text. Every whitespace-separated term must appear. */
  query?: string;
  /** Exact category match. */
  category?: string | null;
  /** Every listed tag must be present. */
  tags?: string[];
};

/** Does this recipe satisfy the filters? */
export function matches(recipe: Recipe, filters: LibraryFilters, search?: string): boolean {
  const haystack = search ?? buildSearchText(recipe);

  const q = (filters.query ?? "").trim().toLowerCase();
  if (q) {
    // Every term must appear, so "lemon dessert" narrows rather than widens.
    for (const term of q.split(/\s+/)) if (!haystack.includes(term)) return false;
  }

  // Same rule as tags: "Baked Goods" and "baked goods" are one shelf.
  if (filters.category && !sameCategory(recipe.category, filters.category)) return false;

  // By meaning, not by spelling: the filter pill a cook tapped says
  // "Gluten-Free", and a recipe saved years ago as "gluten free" is one of the
  // things they meant. collectTags() groups the pills the same way.
  for (const tag of filters.tags ?? []) {
    if (!hasTag(recipe.tags, tag)) return false;
  }
  return true;
}

/** Most recently added first; ties broken by title so the order is stable. */
export function byNewest(a: Recipe, b: Recipe): number {
  if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
  return a.title.localeCompare(b.title);
}

/** Filter and order a library in one step. */
export function queryLibrary(recipes: Recipe[], filters: LibraryFilters = {}): Recipe[] {
  return recipes.filter((r) => matches(r, filters)).sort(byNewest);
}


// ---------------------------------------------------------------------------
// Home dashboard.
//
// Assembled here rather than in the screen so the joins are testable: Home
// shows data that has already gone wrong once in storage (a progress row whose
// recipe no longer exists, a step index past the end of an edited recipe), and
// a dashboard is the worst place to discover that.
// ---------------------------------------------------------------------------

export type ResumableCook = {
  recipe: Recipe;
  /** Clamped into the recipe's current step range. */
  stepIndex: number;
  totalSteps: number;
  updatedAt: number;
};

/**
 * Cooking sessions that can actually be resumed, most recent first.
 *
 * Progress rows outlive the thing they point at. A row whose recipe has been
 * deleted is dropped rather than rendered as a card that opens nothing, and a
 * row pointing past the end of a recipe that has since been shortened is
 * clamped to the last step instead of resuming into empty space.
 */
export function resumableCooks(recipes: Recipe[], sessions: CookProgress[]): ResumableCook[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const out: ResumableCook[] = [];

  for (const session of sessions) {
    const recipe = byId.get(session.recipeId);
    if (!recipe) continue;

    const totalSteps = flattenSteps(recipe).length;
    if (totalSteps === 0) continue; // nothing to resume into

    const stepIndex = Math.min(Math.max(session.stepIndex, 0), totalSteps - 1);
    out.push({ recipe, stepIndex, totalSteps, updatedAt: session.updatedAt });
  }

  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The n most recently added recipes. */
export function recentlyAdded(recipes: Recipe[], limit = 4): Recipe[] {
  return [...recipes].sort(byNewest).slice(0, limit);
}

/** The scale and measurement a recipe with no saved view should open on. */
export type OpeningView = { scale: 0.5 | 1 | 2 | 3 | 4; measurement: Measurement };

/**
 * How to open a recipe the cook has never adjusted.
 *
 * Always batch 1: a scale is a decision about this cooking, not a standing
 * preference, and starting someone at 3x because they once tripled something
 * else would be worse than useless.
 *
 * The measurement is the Settings default, but only where this recipe can
 * offer it -- openingMeasurement() explains why, and what it looked like when
 * it did not.
 */
export function openingView(
  recipe: Recipe | null | undefined,
  preferred: Measurement,
): OpeningView {
  if (!recipe) return { scale: 1, measurement: "original" };
  const units = (recipe.sections ?? []).flatMap((s) => s.ingredients.map((i) => i.unit));
  return { scale: 1, measurement: openingMeasurement(preferred, detectSystem(units)) };
}
