// The upload half of sync — decided and tested, and deliberately not wired up.
//
// Nothing in the app imports this. There is no upload endpoint on the server
// to call, and `pullRecipes` does not reference any of it. What is here is the
// set of decisions that have to be right *before* anything can be enabled,
// written as pure functions so they can be argued with and tested now rather
// than discovered later against somebody's real cookbook.
//
// The governing rule is ADR 0006's: no recipe content is ever silently
// discarded or silently combined. Everything below is a consequence of it.
//
// Enabling this needs, at minimum: the server-side `revision` column and the
// `/api/v1/sync/recipes` write endpoint from docs/native-sync-plan.md, the
// conflict-copy destination from ADR 0015, and a decision from the product
// owner on the reconciliation question in `planReconciliation` below.

import type { Recipe } from "../data/types.ts";
import type { Origin, RecipeOrigin } from "./pull.ts";

// ---------------------------------------------------------------------------
// What a device knows about a recipe it might send
// ---------------------------------------------------------------------------

export type LocalRecipeState = {
  recipeId: string;
  title: string;
  origin: Origin;
  /** Edited locally since the last successful push. */
  dirty: boolean;
  /** Deleted locally; the row is kept as a tombstone until the server agrees. */
  deletedLocally: boolean;
  /** The server revision this device last saw. Null for a recipe never synced. */
  baseRevision: number | null;
};

export type ServerRecipeState = {
  recipeId: string;
  revision: number;
  deleted: boolean;
};

// ---------------------------------------------------------------------------
// First contact: what to do with what is already on the phone
// ---------------------------------------------------------------------------

export type ReconciliationAction =
  /** A seeded sample. Never offered, never uploaded, not even with consent —
   *  every install has the same ids, so uploading one means two phones
   *  claiming the same recipe. */
  | { kind: "never"; reason: "sample" }
  /** Made on this phone and not in the account. The cook is asked. */
  | { kind: "offer"; reason: "local-only" }
  /** Already in the account, pulled from it. Nothing to reconcile. */
  | { kind: "none"; reason: "already-cloud" };

export function planReconciliation(local: LocalRecipeState): ReconciliationAction {
  if (local.origin === "sample") return { kind: "never", reason: "sample" };
  if (local.origin === "cloud") return { kind: "none", reason: "already-cloud" };
  return { kind: "offer", reason: "local-only" };
}

/**
 * The first upload is an offer, not a sweep.
 *
 * Default: send nothing. A cook who signs in on a phone that happens to hold
 * recipes has not asked for them to be published into an account, and the
 * irreversible direction is the one that adds. `chosenIds` is what they picked.
 */
export function planFirstUpload(
  locals: readonly LocalRecipeState[],
  chosenIds: ReadonlySet<string>,
): { upload: string[]; offered: string[]; refused: string[] } {
  const upload: string[] = [];
  const offered: string[] = [];
  const refused: string[] = [];
  for (const local of locals) {
    const plan = planReconciliation(local);
    if (plan.kind === "never") { refused.push(local.recipeId); continue; }
    if (plan.kind === "none") continue;
    offered.push(local.recipeId);
    if (chosenIds.has(local.recipeId)) upload.push(local.recipeId);
  }
  return { upload, offered, refused };
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

export type ConflictOutcome =
  | { kind: "send"; reason: "new" | "unchanged-base" }
  | { kind: "conflict"; reason: "server-moved" }
  | { kind: "conflict"; reason: "deleted-here-edited-there" }
  | { kind: "conflict"; reason: "edited-here-deleted-there" }
  | { kind: "skip"; reason: "not-dirty" | "already-deleted-both" };

/**
 * Decide what a single pending change should do, given what the server says.
 *
 * Revisions, never clocks: a phone's clock is wrong, changes with timezones
 * and can be set by its owner (ADR 0006).
 */
export function classifyChange(local: LocalRecipeState, server: ServerRecipeState | null): ConflictOutcome {
  if (!local.dirty && !local.deletedLocally) return { kind: "skip", reason: "not-dirty" };

  // Never seen by the server, and not deleted here: a plain create.
  if (!server) {
    if (local.deletedLocally) return { kind: "skip", reason: "already-deleted-both" };
    return { kind: "send", reason: "new" };
  }

  if (server.deleted && local.deletedLocally) return { kind: "skip", reason: "already-deleted-both" };

  // Deleted there, edited here. ADR 0006 resolves the shared-data version of
  // this in favour of the edit, and the same instinct applies: a deletion must
  // not quietly take an edit with it.
  if (server.deleted && local.dirty) return { kind: "conflict", reason: "edited-here-deleted-there" };

  // Deleted here, moved on there. The delete does not win silently.
  if (local.deletedLocally && local.baseRevision !== null && server.revision !== local.baseRevision) {
    return { kind: "conflict", reason: "deleted-here-edited-there" };
  }

  if (local.baseRevision === null) {
    // We hold an edit for a recipe the server has but this device never
    // synced. That is a conflict, not a create: sending it would overwrite a
    // version nobody on this device has seen.
    return { kind: "conflict", reason: "server-moved" };
  }

  if (server.revision !== local.baseRevision) return { kind: "conflict", reason: "server-moved" };
  return { kind: "send", reason: "unchanged-base" };
}

/**
 * What a conflict does, once detected.
 *
 * Last write wins and the loser is kept — never merged. An ingredient list
 * assembled from two versions is a recipe nobody wrote, and somebody will cook
 * from it (ADR 0006).
 */
export type ConflictResolution = {
  /** The version that becomes current. */
  winner: "local" | "server";
  /** Always true: the other version is written to history, never dropped. */
  preserveLoser: true;
  /** Shown to the cook, because a silent resolution is the thing to avoid. */
  notify: true;
};

export function resolveConflict(outcome: ConflictOutcome): ConflictResolution | null {
  if (outcome.kind !== "conflict") return null;
  switch (outcome.reason) {
    // An edit beats a delete in both directions. Restoring a recipe someone
    // still wants costs a deletion they can repeat; the opposite costs the
    // recipe.
    case "edited-here-deleted-there": return { winner: "local", preserveLoser: true, notify: true };
    case "deleted-here-edited-there": return { winner: "server", preserveLoser: true, notify: true };
    // Two edits: the later write is current, and this device's write is the
    // later one by definition — it is being sent now. The superseded server
    // version goes to history.
    case "server-moved": return { winner: "local", preserveLoser: true, notify: true };
  }
}

// ---------------------------------------------------------------------------
// Sending it safely
// ---------------------------------------------------------------------------

/**
 * A key that makes a retry harmless.
 *
 * A push that times out may or may not have been applied. The key is derived
 * from what is being sent — the recipe, the base it was edited from, and the
 * device — so a retry of the *same* change carries the same key and the server
 * can recognise it, while a genuinely new edit carries a different one.
 */
export function idempotencyKey(input: {
  deviceId: string;
  recipeId: string;
  baseRevision: number | null;
  contentHash: string;
}): string {
  return [input.deviceId, input.recipeId, String(input.baseRevision ?? "new"), input.contentHash].join(":");
}

/** 1s, 2s, 4s … capped, so a failing push does not hammer the server. */
export function retryDelayMs(attempt: number, jitter = Math.random): number {
  const ceiling = Math.min(1000 * Math.pow(2, Math.max(0, Math.min(attempt, 10))), 5 * 60_000);
  return Math.round(ceiling * (0.5 + jitter() * 0.5));
}

/**
 * The order changes are sent in.
 *
 * Creates before updates before deletes, and within each, oldest first. A
 * delete sent before the create it depends on is a delete of nothing; an
 * update before its create is a conflict that did not need to happen.
 */
export function orderForUpload(changes: readonly LocalRecipeState[]): LocalRecipeState[] {
  const rank = (c: LocalRecipeState) => (c.deletedLocally ? 2 : c.baseRevision === null ? 0 : 1);
  return [...changes].sort((a, b) => rank(a) - rank(b) || a.recipeId.localeCompare(b.recipeId));
}

/**
 * Nothing here is reachable yet, and this says so in code as well as in prose:
 * anything that tries to perform an upload gets an error naming what is
 * missing, rather than a silent no-op that could be mistaken for success.
 */
export const UPLOAD_ENABLED = false;

export function assertUploadEnabled(): never {
  throw new Error(
    "Upload sync is not enabled: it needs the server revision column, the /api/v1/sync/recipes "
    + "write endpoint, and the conflict-copy destination from ADR 0015. See docs/native-sync-plan.md.",
  );
}

export type { RecipeOrigin, Recipe };
