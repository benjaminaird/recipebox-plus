// Recipe version history on the device (ADR 0015).
//
// The server has had this since the versioned write API: recipe_versions,
// append-only, each row carrying a cause. The device had none of it — no
// table, no screen, no call to either /versions endpoint — which means that
// until now every change a cook made offline was unrecoverable, and the ADR's
// "any change can be reverted" was true only of changes made while online with
// uploads enabled. That is not what the ADR says.
//
// So history is local-first, like everything else here. Three rules, all from
// the ADR:
//
//   Append-only. An edit writes a new version and leaves the earlier ones
//   alone. Nothing in the app rewrites a version row.
//
//   The arrival version is kept. Version 1 is the recipe as it came —
//   imported, pasted, photographed or typed — and is the answer to "what did
//   the source actually say?", which is the question a cook asks when a recipe
//   stops working.
//
//   Reverting appends. Going back to version 3 writes version 7 holding
//   version 3's content, so undoing never destroys the history it undid.
//
// Each row holds the whole recipe. A diff would be smaller and is the wrong
// trade: a chain of diffs is only readable if every link is intact, and the
// one thing this table exists to survive is a half-finished write.
//
// Parameterised over the database for the same reason the sync store is: the
// SQL is the part that can be wrong, and a test that creates the real table in
// a real SQLite and reads back what these functions wrote is the only kind
// that proves it.

import type { Recipe } from "./types.ts";

export type VersionDb = {
  getFirstAsync<T>(sql: string, args?: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, args?: unknown[]): Promise<T[]>;
  runAsync(sql: string, args?: unknown[]): Promise<unknown>;
};

/**
 * Why a version exists.
 *
 * The ADR asks for this by name — "each version records what caused it … so
 * history reads as a story rather than a list of timestamps". A cook scanning
 * their history wants to find the Helper's change, or the one they made the
 * night it went wrong, and a column of dates cannot tell them which is which.
 */
export type VersionCause =
  | "imported"          // how it arrived. Always the first version.
  | "edited"            // the cook changed it by hand.
  | "helper"            // accepted from the AI Recipe Helper (ADR 0016).
  | "resolved-flag"     // an import uncertainty settled (ADR 0014).
  | "resolved-conflict" // a sync conflict decided (ADR 0006).
  | "reverted"          // an earlier version made current again.
  | "restored";         // brought back from the Trash.

export type RecipeVersion = {
  id: string;
  recipeId: string;
  /** 1, 2, 3 … in the order this device wrote them. */
  seq: number;
  cause: VersionCause;
  /** One line for the list: "Lower in sugar", "Kept the cloud copy". */
  note: string;
  createdAt: number;
  recipe: Recipe;
};

/** A history row without its body, for a list that may be long. */
export type VersionSummary = Omit<RecipeVersion, "recipe">;

type Row = {
  id: string;
  recipe_id: string;
  seq: number;
  cause: string;
  note: string | null;
  created_at: number;
  json: string;
};

const CAUSES: ReadonlyArray<VersionCause> = [
  "imported", "edited", "helper", "resolved-flag", "resolved-conflict", "reverted", "restored",
];

/**
 * A cause read back from the database is checked, not trusted.
 *
 * Not defensiveness for its own sake: a row written by a newer build of the
 * app can be read by an older one after a downgrade, and a cause it has never
 * heard of must render as something rather than crashing the history screen.
 */
function readCause(value: string): VersionCause {
  return (CAUSES as readonly string[]).includes(value) ? (value as VersionCause) : "edited";
}

function rowToSummary(r: Row): VersionSummary {
  return {
    id: r.id,
    recipeId: r.recipe_id,
    seq: Number(r.seq),
    cause: readCause(r.cause),
    note: r.note ?? "",
    createdAt: Number(r.created_at),
  };
}

function rowToVersion(r: Row): RecipeVersion | null {
  try {
    return { ...rowToSummary(r), recipe: JSON.parse(r.json) as Recipe };
  } catch {
    // A row whose body will not parse is a row we cannot offer to restore.
    // Dropping it from the list is right; deleting it is not ours to do.
    return null;
  }
}

/**
 * Append a version. Call inside the transaction that makes the change.
 *
 * Inside, for the reason the outbox entry is inside one: a recipe saved
 * without its version is a change the cook can never get back, and nothing on
 * screen would say so. One transaction makes the change and its record the
 * same event.
 *
 * `seq` is read and incremented in that transaction. SQLite gives one writer
 * at a time, so there is no second claimant on the number.
 */
export async function appendVersion(
  db: VersionDb,
  input: { recipe: Recipe; cause: VersionCause; note?: string; at?: number },
): Promise<VersionSummary> {
  const at = input.at ?? Date.now();
  const last = await db.getFirstAsync<{ seq: number | null }>(
    `SELECT MAX(seq) AS seq FROM recipe_versions WHERE recipe_id = ?`, [input.recipe.id],
  );
  const seq = Number(last?.seq ?? 0) + 1;
  // The id carries the recipe and the sequence rather than being random, so an
  // append that is somehow retried writes the same row instead of a duplicate.
  const id = `${input.recipe.id}:${seq}`;
  await db.runAsync(
    `INSERT OR IGNORE INTO recipe_versions (id, recipe_id, seq, cause, note, created_at, json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.recipe.id, seq, input.cause, input.note ?? "", at, JSON.stringify(input.recipe)],
  );
  return { id, recipeId: input.recipe.id, seq, cause: input.cause, note: input.note ?? "", createdAt: at };
}

/**
 * Record the arrival version, once.
 *
 * Idempotent on purpose: it is called from the save path, which cannot always
 * tell a first save from a later one (a pull, a restore and an edit all end up
 * here), and recording the arrival twice would make the history claim the
 * recipe arrived twice.
 */
export async function recordArrival(
  db: VersionDb, recipe: Recipe, note = "As it arrived", at?: number,
): Promise<void> {
  const any = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM recipe_versions WHERE recipe_id = ?`, [recipe.id],
  );
  if (Number(any?.n ?? 0) > 0) return;
  await appendVersion(db, { recipe, cause: "imported", note, at });
}

/** The history, newest first. Bodies left behind: a history list shows lines. */
export async function listVersions(db: VersionDb, recipeId: string, limit = 100): Promise<VersionSummary[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT id, recipe_id, seq, cause, note, created_at, '' AS json
       FROM recipe_versions WHERE recipe_id = ?
      ORDER BY seq DESC LIMIT ?`,
    [recipeId, limit],
  );
  return rows.map(rowToSummary);
}

/** One version, with its body, to show or to restore. */
export async function getVersion(db: VersionDb, recipeId: string, seq: number): Promise<RecipeVersion | null> {
  const row = await db.getFirstAsync<Row>(
    `SELECT id, recipe_id, seq, cause, note, created_at, json
       FROM recipe_versions WHERE recipe_id = ? AND seq = ?`,
    [recipeId, seq],
  );
  return row ? rowToVersion(row) : null;
}

/** The recipe as it arrived, if this device has it. */
export async function originalVersion(db: VersionDb, recipeId: string): Promise<RecipeVersion | null> {
  const row = await db.getFirstAsync<Row>(
    `SELECT id, recipe_id, seq, cause, note, created_at, json
       FROM recipe_versions WHERE recipe_id = ? ORDER BY seq ASC LIMIT 1`,
    [recipeId],
  );
  return row ? rowToVersion(row) : null;
}

/** How many versions a recipe has, for a "History (4)" row. */
export async function countVersions(db: VersionDb, recipeId: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM recipe_versions WHERE recipe_id = ?`, [recipeId],
  );
  return Number(row?.n ?? 0);
}

/**
 * The content to write when going back to an earlier version.
 *
 * Pure, and separate from the write, because what reverting MEANS is the part
 * worth testing: the earlier content, carrying the recipe's identity and its
 * creation date forward, with `updatedAt` saying when the revert happened. A
 * revert that restored the old `updatedAt` would sort the recipe back into the
 * library where it was months ago, and look like nothing had happened.
 *
 * It returns content for the caller to save through the ordinary save path, so
 * a revert queues an upload and appends a version exactly like any other
 * change. A revert that wrote the row itself would be a second way to change
 * a recipe, and the one that skipped the queue.
 */
export function revertedContent(current: Recipe, target: Recipe, at = Date.now()): Recipe {
  return {
    ...target,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: at,
  };
}

/** "Reverted to version 3" — the note the revert's own version carries. */
export function revertNote(seq: number): string {
  return `Went back to version ${seq}`;
}

/**
 * What the history screen says about a version.
 *
 * The cause in the cook's words, not the enum's. "resolved-conflict" is a
 * sentence the product should never show anybody.
 */
export function causeLabel(cause: VersionCause): string {
  switch (cause) {
    case "imported": return "As it arrived";
    case "edited": return "Edited";
    case "helper": return "Recipe Helper";
    case "resolved-flag": return "Uncertainty settled";
    case "resolved-conflict": return "Conflict resolved";
    case "reverted": return "Reverted";
    case "restored": return "Restored";
    default: return "Changed";
  }
}
