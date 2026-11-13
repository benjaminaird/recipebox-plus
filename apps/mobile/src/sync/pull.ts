// Pulling a cloud library onto the phone.
//
// Stage one of ADR 0006's sync, and deliberately the half that cannot lose
// anything: it reads. There is no upload path here and no write endpoint on
// the server to call, so "this must never overwrite or delete a cloud recipe"
// is structural rather than a rule somebody has to remember.
//
// The rules it does have to remember are about the *local* library, which is
// the one this code can damage:
//
//   A recipe the cook made on this phone is never overwritten by a pull.
//   A seeded sample is never overwritten, and never becomes a cloud recipe.
//   A re-pull updates in place rather than making a second copy.
//   An interrupted pull resumes instead of starting again.
//
// The first two mean a pull can arrive holding a recipe it is not allowed to
// store. It is skipped and reported, not forced in and not silently dropped:
// the plan's adoption step is where a person decides what to do about it.

import type { Recipe } from "../data/types.ts";

/** Where a recipe on this device came from. Kept apart from its content. */
export type Origin = "sample" | "local" | "cloud";

export type RecipeOrigin = {
  recipeId: string;
  origin: Origin;
  /** The account that pulled it. Null for samples and local recipes. */
  accountId: string | null;
  /** The cloud owner — different from accountId for a household recipe. */
  ownerId: string | null;
  shared: boolean;
  serverUpdatedAt: string | null;
  pulledAt: string | null;
};

/** One recipe as `/api/v1/recipes` sends it: the recipe, and facts about it. */
export type RecipeEnvelope = {
  recipe: Recipe;
  serverId: string;
  ownerId: string;
  ownerName: string | null;
  shared: boolean;
  updatedAt: string;
  createdAt: string;
};

export type RecipePage = {
  recipes: RecipeEnvelope[];
  nextCursor: string | null;
  syncedAt: string;
};

export type PullStore = {
  /** Ids seeded by the app itself. They may never be associated with an account. */
  seededIds(): Promise<string[]>;
  getOrigin(recipeId: string): Promise<RecipeOrigin | null>;
  /** Write the recipe and its provenance together, or neither. */
  putCloudRecipe(input: { envelope: RecipeEnvelope; accountId: string }): Promise<void>;
  /** Where a previous pull stopped, so an interrupted one resumes. */
  getCursor(accountId: string): Promise<string | null>;
  setCursor(accountId: string, cursor: string | null): Promise<void>;
  setLastSyncedAt(accountId: string, syncedAt: string): Promise<void>;
};

export type SkipReason = "sample-collision" | "local-collision" | "other-account" | "invalid";

export type Skipped = { recipeId: string; title: string; reason: SkipReason };

export type PullResult = {
  /** Finished the whole library. False when it stopped early. */
  complete: boolean;
  pages: number;
  stored: number;
  updated: number;
  skipped: Skipped[];
  /** Set when the pull stopped on an error rather than at the end. */
  stoppedBy: "network" | "server" | "limit" | null;
  syncedAt: string | null;
};

/**
 * Is this envelope allowed to be written over what is already here?
 *
 * Pure, and separated out because it is the decision that can lose a recipe.
 */
export function decideWrite(
  existing: RecipeOrigin | null,
  seeded: ReadonlySet<string>,
  accountId: string,
): { write: boolean; reason?: SkipReason; update: boolean } {
  if (!existing) {
    // Nothing here under that id — unless the app seeded it and the row was
    // since removed from provenance, which still makes it a sample's id.
    return { write: true, update: false };
  }
  if (existing.origin === "sample") return { write: false, reason: "sample-collision", update: false };
  if (existing.origin === "local") return { write: false, reason: "local-collision", update: false };
  // A cloud recipe from a different account should be impossible — each
  // account gets its own SQLite file — but if the stores were ever merged,
  // refusing is the safe answer.
  if (existing.accountId && existing.accountId !== accountId) {
    return { write: false, reason: "other-account", update: false };
  }
  return { write: true, update: true };
}

/** Enough of a recipe to store. The server is trusted for content, not shape. */
export function isStorableRecipe(value: unknown): value is Recipe {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return false;
  if (typeof r.title !== "string" || r.title.length === 0) return false;
  if (!Array.isArray(r.sections) || r.sections.length === 0) return false;
  return true;
}

export type PullOptions = {
  store: PullStore;
  accountId: string;
  /** Fetch one page. The caller supplies this so the session manager — and its
   *  refresh-once-on-401 — is the only thing that knows about tokens. */
  fetchPage: (cursor: string | null) => Promise<RecipePage>;
  /** Stop after this many pages. A guard against a server that never ends. */
  maxPages?: number;
  onProgress?: (progress: { pages: number; stored: number; updated: number }) => void;
};

const DEFAULT_MAX_PAGES = 200;

export async function pullRecipes(options: PullOptions): Promise<PullResult> {
  const { store, accountId, fetchPage } = options;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const seeded = new Set(await store.seededIds());
  let cursor = await store.getCursor(accountId);

  const result: PullResult = {
    complete: false, pages: 0, stored: 0, updated: 0, skipped: [], stoppedBy: null, syncedAt: null,
  };

  while (result.pages < maxPages) {
    let page: RecipePage;
    try {
      page = await fetchPage(cursor);
    } catch (err) {
      // The cursor stays where it was, so the next attempt resumes from the
      // last page that was fully stored rather than from the beginning.
      result.stoppedBy = (err as { name?: string }).name === "AuthNetworkError" ? "network" : "server";
      return result;
    }

    for (const envelope of page.recipes) {
      if (!envelope || !isStorableRecipe(envelope.recipe)) {
        result.skipped.push({
          recipeId: String((envelope && envelope.recipe && (envelope.recipe as { id?: string }).id) || "unknown"),
          title: "",
          reason: "invalid",
        });
        continue;
      }
      const id = envelope.recipe.id;
      // A seeded id is a sample even if provenance has been lost.
      const existing = (await store.getOrigin(id))
        ?? (seeded.has(id) ? { recipeId: id, origin: "sample" as Origin, accountId: null, ownerId: null, shared: false, serverUpdatedAt: null, pulledAt: null } : null);
      const decision = decideWrite(existing, seeded, accountId);
      if (!decision.write) {
        result.skipped.push({ recipeId: id, title: envelope.recipe.title, reason: decision.reason! });
        continue;
      }
      await store.putCloudRecipe({ envelope, accountId });
      if (decision.update) result.updated += 1; else result.stored += 1;
    }

    result.pages += 1;
    cursor = page.nextCursor;
    // Persisted per page, after its recipes are written. An interruption
    // between pages costs nothing; one mid-page re-reads that page, and the
    // writes are upserts, so re-reading is free of consequence.
    await store.setCursor(accountId, cursor);
    if (options.onProgress) options.onProgress({ pages: result.pages, stored: result.stored, updated: result.updated });

    if (!cursor) {
      result.complete = true;
      result.syncedAt = page.syncedAt;
      await store.setLastSyncedAt(accountId, page.syncedAt);
      return result;
    }
  }

  result.stoppedBy = "limit";
  return result;
}
