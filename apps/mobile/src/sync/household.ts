// Recipes somebody else in the household shared.
//
// Pure. No SQLite, no network.
//
// These do not come down the delta feed, and that is deliberate rather than a
// gap: /api/v1/sync/recipes is a REPLICA of this account's own recipes, and a
// replica of somebody else's recipe is a copy this account could then be asked
// to write back. They come down the library view at /api/v1/recipes instead,
// which answers the same question the browser asks and enforces household
// membership in the query itself.
//
// So a household recipe on this phone is a cached view, not a replica. Three
// consequences, and all of the rules here follow from them:
//
//   It is read-only. The owner may edit, delete and restore; a member may
//   read, search, scale, plan, shop and cook. Wanting to change it is what
//   "Save my own copy" is for.
//
//   It is never queued for upload, by any path. There is nothing this account
//   could legitimately say about it.
//
//   It disappears when access does. A recipe that stops appearing in the
//   library view is one this account may no longer see, and keeping a cached
//   copy of it would make the phone the one place the revocation did not
//   reach.

import type { Recipe } from "../data/types.ts";
import type { RecipeEnvelope } from "./pull.ts";

/** What this device already holds, as far as these rules care. */
export type HeldRecipe = {
  recipeId: string;
  origin: "sample" | "local" | "cloud";
  /** Somebody else's, cached for this account to read. */
  shared: boolean;
};

export type HouseholdPlan = {
  /** Shared recipes to write or refresh. */
  store: RecipeEnvelope[];
  /** Cached shared recipes this account may no longer see. */
  revoke: string[];
};

/**
 * What to do with a complete household read.
 *
 * `visible` must be the WHOLE library view, not a page of it: revocation is
 * decided by absence, and absence from one page of several means nothing. The
 * caller reads every page before asking.
 *
 * Only shared recipes are touched. This account's own cloud recipes belong to
 * the delta feed, which knows about revisions and deletions; writing them from
 * here would clobber an unsent edit with a view that has no idea one exists.
 */
export function planHouseholdRead(
  visible: readonly RecipeEnvelope[],
  held: readonly HeldRecipe[],
): HouseholdPlan {
  const shared = visible.filter((e) => e.shared === true);
  const stillVisible = new Set(shared.map((e) => e.recipe.id));

  return {
    store: shared,
    // Only cached shared copies. A recipe this account owns, a sample, or
    // something written on this phone is not the household's to withdraw —
    // and a member who loses access keeps everything that was theirs.
    revoke: held
      .filter((r) => r.shared && r.origin === "cloud" && !stillVisible.has(r.recipeId))
      .map((r) => r.recipeId),
  };
}

/**
 * Whether this account may change a recipe at all.
 *
 * The server enforces this too — a write aimed at somebody else's recipe finds
 * nothing to update, because every query is scoped to the caller. This is the
 * half that lets the interface say so before the cook has typed anything,
 * which is the difference between a rule and a rejection.
 */
export function mayEdit(held: HeldRecipe | null): boolean {
  if (!held) return true;              // not yet known: a new recipe
  return !held.shared;
}

// ---------------------------------------------------------------------------
// Save my own copy
// ---------------------------------------------------------------------------

/**
 * A household recipe, made this account's own.
 *
 * Everything that is the recipe is carried over unchanged: quantities as
 * written, the sections, the steps and the ids those steps reference, the
 * tags, the category, and the source attribution. Measurements are not
 * converted — ADR 0021 — because a copy that quietly became metric is not the
 * same recipe, and the cook asked for a copy.
 *
 * What changes is identity and provenance. A new id, because two recipes with
 * one id is the problem every rule about samples exists to prevent. And a note
 * of where it came from, so the copy can say so rather than presenting itself
 * as something this cook wrote.
 *
 * The original is not touched. Nothing here returns anything but a new recipe.
 *
 * @param newId supplied rather than generated, so the same request twice
 * produces the same recipe instead of two.
 */
export function copyForMyself(
  original: Recipe,
  from: { ownerName: string | null },
  newId: string,
  now: number,
): Recipe {
  return {
    ...original,
    id: newId,
    createdAt: now,
    updatedAt: now,
    source: attributeCopy(original, from.ownerName),
  };
}

/**
 * Where a copy came from, without losing where the original came from.
 *
 * A household recipe usually already has a source — a website, a cookbook —
 * and that is the recipe's attribution, not the sharer's. Overwriting it would
 * credit a member of the household with somebody else's recipe. So the
 * original source is kept exactly, and the sharing is recorded in `reference`,
 * which ADR 0020 keeps for things with no link.
 *
 * Only where there is no source at all does the copy take one of its own:
 * "from <name>" is better attribution than none.
 */
function attributeCopy(original: Recipe, ownerName: string | null): Recipe["source"] {
  const sharer = ownerName && ownerName.trim() ? ownerName.trim() : "someone in your household";
  const note = `Copied from ${sharer}’s recipe`;

  if (!original.source) {
    return { kind: "family", method: "manual", reference: note };
  }
  const existing = original.source;
  return {
    ...existing,
    reference: existing.reference ? `${existing.reference} · ${note}` : note,
  };
}
