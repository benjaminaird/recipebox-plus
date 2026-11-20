// Local SQLite store. Everything the app shows comes from here.
//
// No network, no account, no sync (ADR 0004 is the eventual destination; this
// is the local half of it). The recipe is stored as its own JSON rather than
// shredded across columns, so the shape on disk is exactly the shape the rest
// of the product uses and nothing has to be translated back. The columns
// beside it exist only to make listing and searching cheap.
import * as SQLite from "expo-sqlite";
import type { CookProgress, Recipe } from "./types";
import type { Measurement } from "../domain/convert";
import {
  isDateKey, parseScale, parseSlot, toDateKey, type PlannedMeal,
} from "../domain/plan";
import type {
  ShoppingItem, ShoppingList, ShoppingListSource,
} from "../domain/shoppingList";
import { hasTag, normalizeCategory, normalizeRecipeTags, sameCategory } from "../domain/tags";
import type { Scale } from "../domain/present";
import type { Timer } from "../domain/timer";
import { buildSearchText, byNewest, type LibraryFilters } from "./query";
import { SAMPLE_RECIPES } from "./sampleRecipes";
import { ADDED_COLUMNS, SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";
import {
  appendVersion, countVersions, getVersion, listVersions, originalVersion,
  recordArrival, revertNote, revertedContent,
  type RecipeVersion, type VersionCause, type VersionDb, type VersionSummary,
} from "./versions.ts";

const DB_NAME = "recipebox.db";



let handle: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Which file the handle is on.
 *
 * Not a constant, because two accounts on one phone do not share a library.
 * `src/auth/localStore.ts` decides which file an account may open and why;
 * this is the half that actually opens it. They were written apart and only
 * one of them was wired up, so the resolver chose an isolated store, the
 * Account screen told the cook they had one, and every query still ran
 * against the base file. The second account on a shared phone read the
 * first's recipes while the interface said otherwise.
 */
let openName: string | null = null;

/**
 * Resolved the first time a store is chosen.
 *
 * Opening defaults to nothing rather than to the base library, because the
 * default *was* the base library and that is how one account's recipes reached
 * another's screen: the provider resolves the right store asynchronously, and
 * until it had, every query ran against the shared file. On a shared phone the
 * Home screen showed the owner's library to a guest for as long as that took —
 * seen on a simulator as a list of thirteen recipes that became eight.
 *
 * So a query made before the decision waits for it instead of guessing. The
 * app still mounts and renders with no account, no server and no network: the
 * only thing that waits is a read, and reads were already asynchronous.
 */
let announced: (() => void) | null = null;
const storeChosen: Promise<void> = new Promise((resolve) => { announced = resolve; });

/** The file currently open, or null before any store has been chosen. */
export function activeLocalStore(): string | null {
  return openName;
}

/**
 * Open a different local library from here on.
 *
 * Idempotent: asking for the file already open does nothing, which is what
 * makes it safe to call on every restore and every change of account. The
 * previous handle is closed afterwards and its failure ignored — a close that
 * races an in-flight read must not take down the switch, and the handle is
 * unreachable either way.
 */
export async function useLocalStore(name: string): Promise<void> {
  const next = (name || "").trim() || DB_NAME;

  // The first decision is not a switch. Nothing is open yet — a query that
  // arrived early is parked on `storeChosen` and will open this name when it
  // is released — so there is nothing to close. Treating it as a switch closed
  // that parked handle out from under the first reads, and the library came up
  // empty while its file sat on disk with every recipe still in it.
  if (openName === null) {
    openName = next;
    announced?.();
    return;
  }

  if (next === openName) return;
  const previous = handle;
  openName = next;
  handle = null;
  if (previous) {
    try {
      await (await previous).closeAsync();
    } catch {
      // Already closed, never opened, or busy. Nothing here can be recovered
      // and nothing depends on it.
    }
  }
}

/** The one handle. Exported so the sync store writes through the same
 *  migrations and the same connection as everything else. */
export function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  return open();
}

function open(): Promise<SQLite.SQLiteDatabase> {
  if (!handle) {
    handle = storeChosen.then(() => {
      // Captured, so a switch during the open resolves the handle it started.
      const name = openName ?? DB_NAME;
      return SQLite.openDatabaseAsync(name).then(async (db) => {
        await migrate(db);
        await seedIfEmpty(db);
        return db;
      });
    });
  }
  return handle;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(SCHEMA_SQL);

  // Columns on tables that already carry rows. See schema.ts for why these are
  // separate from the creations, and test/cross-feature.test.ts for the rule
  // they are held to.
  for (const { table, column, definition } of ADDED_COLUMNS) {
    await addColumn(db, table, column, definition);
  }

  await db.runAsync(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(SCHEMA_VERSION)],
  );
}


/**
 * Add a column if it is not already there.
 *
 * Asked of the table rather than inferred from the stored schema version,
 * because the stored version is a claim and PRAGMA table_info is the fact. An
 * install that was interrupted half way through a migration has a version
 * number that is wrong in one direction or the other; the column either exists
 * or it does not.
 */
async function addColumn(
  db: SQLite.SQLiteDatabase, table: string, column: string, definition: string,
): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((c) => c.name === column)) return;
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Put the sample library in, once per sample.
 *
 * Two things have to hold at the same time. A recipe the user deleted must
 * stay deleted, and an edited recipe must never be overwritten -- so this
 * cannot key off row count, and it cannot re-run over the whole sample set.
 * But a sample added later must still arrive, or a development install sits
 * on a stale library forever and the new recipe is invisible on the device.
 *
 * So meta remembers which sample ids have EVER been seeded. A sample is
 * inserted only if its id is not on that list, whatever the library now
 * contains. Deleting a sample leaves its id on the list, so it stays gone.
 *
 * Installs predating this carry `seeded = '1'` and no list; their list is
 * backfilled from whatever ids are present, which is the best available
 * statement of "already offered once".
 */
async function seedIfEmpty(db: SQLite.SQLiteDatabase): Promise<void> {
  const listRow = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'seeded_ids'`,
  );

  let seeded: string[] = [];
  if (listRow?.value) {
    try {
      const parsed: unknown = JSON.parse(listRow.value);
      if (Array.isArray(parsed)) seeded = parsed.filter((v): v is string => typeof v === "string");
    } catch {
      seeded = []; // unreadable list: treat as nothing seeded, upsert is id-safe
    }
  } else {
    const legacy = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM meta WHERE key = 'seeded'`,
    );
    if (legacy?.value === "1") {
      const rows = await db.getAllAsync<{ id: string }>(`SELECT id FROM recipes`);
      seeded = rows.map((r) => r.id);
    }
  }

  // Every seeded id is recorded as a sample, whether or not it was seeded
  // just now. Nothing used to write this down: the fact lived only in
  // `seeded_ids`, so a sample looked exactly like a recipe the cook had
  // written on the phone — and the Account screen offered to put all seven
  // into their account. Every install ships the same ids, so accepting that
  // would mean two phones claiming one recipe, which is the one thing the
  // upload rules exist to prevent. Those rules were right and simply never
  // had the fact to act on.
  //
  // Done on every open, cheaply, rather than only when something is seeded:
  // installs that already have their samples need it most.
  //
  // Filtered to the ids this app actually ships, which matters more than it
  // looks. The legacy branch above sets `seeded` to EVERY recipe id on the
  // phone -- that is its honest best guess at "already offered once", and it
  // was harmless while the list only gated re-seeding. Handing it to
  // markSamples unfiltered would stamp a long-standing user's entire
  // cookbook as sample data, and a sample can never be uploaded: their
  // recipes would quietly stop being able to reach their account, for ever,
  // with nothing on screen to say why.
  const sampleIds = new Set(SAMPLE_RECIPES.map((r) => r.id));
  await markSamples(db, seeded.filter((id) => sampleIds.has(id)));

  const missing = SAMPLE_RECIPES.filter((r) => !seeded.includes(r.id));
  if (missing.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const recipe of missing) await upsert(db, recipe);
    await markSamples(db, missing.map((r) => r.id));
    const next = JSON.stringify([...seeded, ...missing.map((r) => r.id)]);
    await db.runAsync(
      `INSERT INTO meta (key, value) VALUES ('seeded_ids', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [next],
    );
    await db.runAsync(
      `INSERT INTO meta (key, value) VALUES ('seeded', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
    );
  });
}

/**
 * Record which recipes came from the sample library.
 *
 * `ON CONFLICT DO NOTHING`, so a recipe whose provenance is already known
 * keeps it. A sample never becomes a cloud recipe, but an id present in
 * `seeded_ids` and absent from the library is a sample the cook deleted, and
 * writing a row for it is harmless: nothing reads provenance for a recipe
 * that is not there.
 */
async function markSamples(db: SQLite.SQLiteDatabase, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await db.runAsync(
      `INSERT INTO recipe_origin (recipe_id, origin, shared, adopted)
       VALUES (?, 'sample', 0, 0)
       ON CONFLICT(recipe_id) DO NOTHING`,
      [id],
    );
  }
}

/**
 * Insert or update one recipe row. Exported for the sync store, which has to
 * write the recipe and its provenance inside one transaction.
 *
 * `times` exists because a recipe arriving from the cloud does not carry the
 * local model's timestamps. The server stores the recipe body and the times it
 * was created and changed as separate things, so the body it sends back has no
 * createdAt or updatedAt in it -- and writing it without them put a null into
 * a NOT NULL column and failed the whole pull. The caller that knows the times
 * passes them; everything else keeps using the recipe's own.
 */
export async function upsertRecipeRow(
  db: SQLite.SQLiteDatabase,
  recipe: Recipe,
  times?: { createdAt: number; updatedAt: number },
): Promise<void> {
  return upsert(db, recipe, times);
}

async function upsert(
  db: SQLite.SQLiteDatabase,
  recipe: Recipe,
  times?: { createdAt: number; updatedAt: number },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO recipes (id, title, category, tags, search, created_at, updated_at, json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, category = excluded.category, tags = excluded.tags,
       search = excluded.search, updated_at = excluded.updated_at, json = excluded.json`,
    [
      recipe.id,
      recipe.title,
      recipe.category ?? null,
      JSON.stringify(recipe.tags ?? []),
      buildSearchText(recipe),
      times ? times.createdAt : recipe.createdAt,
      times ? times.updatedAt : recipe.updatedAt,
      JSON.stringify(recipe),
    ],
  );
}

/**
 * Save a recipe the cook has changed.
 *
 * The first write path for recipe content rather than for a view preference,
 * so it is deliberately narrow: it takes a whole recipe and replaces that one
 * row. It never merges, never deletes, and never touches another record.
 *
 * Tags and the category are normalised here rather than trusted from the
 * caller. Storage is the last place both surfaces pass through, so it is the
 * right place to guarantee that "copycat" and "CopyCat" are one tag however a
 * screen chose to ask for it.
 *
 * `search` is rebuilt from the saved recipe by upsert(), so a recipe stays
 * findable by a tag the moment it is given one.
 */
export async function saveRecipe(
  recipe: Recipe,
  history: { cause?: VersionCause; note?: string } = {},
): Promise<void> {
  const db = await open();
  const saved: Recipe = {
    ...recipe,
    category: normalizeCategory(recipe.category),
    tags: normalizeRecipeTags(recipe.tags),
    updatedAt: recipe.updatedAt || Date.now(),
  };
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM recipes WHERE id = ?`, [saved.id],
    );
    await upsert(db, saved);
    // Saving a recipe that was in the Trash brings it back. Editing is a
    // clearer undelete than any button, and leaving deleted_at set would hide
    // the recipe the cook has just written.
    await db.runAsync(`UPDATE recipes SET deleted_at = NULL WHERE id = ?`, [saved.id]);
    // History, in the same transaction as the change (ADR 0015). A recipe
    // saved without its version is a change the cook can never get back, and
    // nothing on screen would say so.
    //
    // A first save records how the recipe ARRIVED, whatever the caller called
    // the change: version 1 is the answer to "what did the source say?", and
    // there is no earlier state for it to be a change from.
    if (existing) {
      await appendVersion(db as unknown as VersionDb, { recipe: saved, cause: history.cause ?? "edited", note: history.note ?? "" });
    } else {
      await recordArrival(db as unknown as VersionDb, saved, history.note || "As it arrived");
    }
    await record(db, { recipeId: saved.id, kind: "write", recipe: saved, created: !existing });
  });
}

// --- history (ADR 0015) ----------------------------------------------------
//
// Thin wrappers that open the library and hand it to data/versions.ts. The
// logic and the SQL are there, where a test can create the real table in a
// real SQLite and read back what was written; these exist so a screen does
// not have to know how the database is opened.

/**
 * The open library as data/versions.ts wants it.
 *
 * A cast, like the one SyncProvider makes for the sync store, and for the same
 * reason: expo-sqlite's bind-parameter types are narrower than a plain
 * `unknown[]`, and the alternative is importing expo's types into a module
 * whose whole point is to run without expo.
 */
async function historyDb(): Promise<VersionDb> {
  return (await open()) as unknown as VersionDb;
}

/** The history of one recipe, newest first. Bodies left behind. */
export async function recipeHistory(recipeId: string, limit = 100): Promise<VersionSummary[]> {
  return listVersions(await historyDb(), recipeId, limit);
}

/** How many versions a recipe has, for a "History (4)" row. */
export async function recipeHistoryCount(recipeId: string): Promise<number> {
  return countVersions(await historyDb(), recipeId);
}

/** One version, with its body. */
export async function recipeVersion(recipeId: string, seq: number): Promise<RecipeVersion | null> {
  return getVersion(await historyDb(), recipeId, seq);
}

/** The recipe as it arrived, if this device has it. */
export async function recipeOriginal(recipeId: string): Promise<RecipeVersion | null> {
  return originalVersion(await historyDb(), recipeId);
}

/**
 * Make an earlier version current again.
 *
 * It goes through saveRecipe, so a revert queues its upload and appends its
 * own version exactly like any other change. Writing the row here instead
 * would be a second way to change a recipe — and the one that skipped the
 * queue, so the cook's phone and their account would disagree with nothing to
 * say why.
 */
export async function revertRecipe(recipeId: string, seq: number): Promise<Recipe | null> {
  const target = await getVersion(await historyDb(), recipeId, seq);
  if (!target) return null;
  const current = await getRecipe(recipeId);
  if (!current) return null;
  const content = revertedContent(current, target.recipe);
  await saveRecipe(content, { cause: "reverted", note: revertNote(seq) });
  return content;
}

// --- local changes the sync layer has to hear about ------------------------

/**
 * What a change to a recipe looks like to whoever is queuing it.
 *
 * `recipe` is the whole body for a write and null for a delete, which is the
 * same shape the outbox stores and the server accepts.
 */
export type LocalRecipeChange = {
  recipeId: string;
  kind: "write" | "delete";
  recipe: Recipe | null;
  /**
   * This save created the recipe rather than changing one that was there.
   *
   * It decides adoption. A recipe written while signed in belongs to the
   * account whose library it was written into — that is what the cook means
   * by writing it there. A recipe that predates the sign-in does not: it was
   * on the phone before the account was, and uploading it because somebody
   * fixed a typo would put a library into an account nobody offered it to.
   * Those are reconciled deliberately, from the Account screen.
   */
  created: boolean;
};

/**
 * Called inside the transaction that makes the change.
 *
 * Inside, not after. A queue entry written after the commit is a window in
 * which the app can die having saved a recipe nobody will ever upload, and
 * the cook has no way of seeing that it happened. One transaction means the
 * change and the promise to send it are the same event.
 *
 * It is a registered callback rather than an import because this module knows
 * nothing about accounts, sessions or the network, and should not start to:
 * the sync layer reaches down, not the other way around. Nothing is registered
 * when signed out, and the recorder then does nothing at all.
 */
export type ChangeRecorder = (
  db: SQLite.SQLiteDatabase, change: LocalRecipeChange,
) => Promise<void>;

let recorder: ChangeRecorder | null = null;

/** Install the recorder, or clear it with null on sign-out. */
export function recordLocalChanges(next: ChangeRecorder | null): void {
  recorder = next;
}

async function record(db: SQLite.SQLiteDatabase, change: LocalRecipeChange): Promise<void> {
  if (recorder) await recorder(db, change);
}

/**
 * Move a recipe to the Trash.
 *
 * Soft, always. The row stays, the body stays, and `deleted_at` is what makes
 * it leave the library — so "undo" is a column going back to NULL rather than
 * a restore from somewhere, and a deletion that has not reached the server yet
 * is still a recipe this phone can give back.
 */
export async function deleteRecipe(id: string, now = Date.now()): Promise<void> {
  const db = await open();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE recipes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, [now, id]);
    await db.runAsync(`DELETE FROM cook_progress WHERE recipe_id = ?`, [id]);
    await record(db, { recipeId: id, kind: "delete", recipe: null, created: false });
  });
}

/** Take a recipe back out of the Trash. */
export async function restoreRecipe(id: string): Promise<Recipe | null> {
  const db = await open();
  let restored: Recipe | null = null;
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ json: string }>(
      `SELECT json FROM recipes WHERE id = ? AND deleted_at IS NOT NULL`, [id],
    );
    if (!row) return;
    restored = JSON.parse(row.json) as Recipe;
    await db.runAsync(`UPDATE recipes SET deleted_at = NULL WHERE id = ?`, [id]);
    await record(db, { recipeId: id, kind: "write", recipe: restored, created: false });
  });
  return restored;
}

export type TrashedRecipe = { recipe: Recipe; deletedAt: number };

/** The Trash, most recently deleted first. */
export async function listTrash(): Promise<TrashedRecipe[]> {
  const db = await open();
  const rows = await db.getAllAsync<{ json: string; deleted_at: number }>(
    `SELECT json, deleted_at FROM recipes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
  );
  return rows.map((r) => ({ recipe: JSON.parse(r.json) as Recipe, deletedAt: r.deleted_at }));
}

// --- reads -----------------------------------------------------------------

/**
 * The library, newest first, narrowed by filters.
 *
 * Text is narrowed in SQL against the prebuilt search column. Tags and the
 * category are matched in JS, because both are matched by MEANING rather than
 * by exact string -- "Gluten free" and "Gluten-Free" are one tag, "baked
 * goods" and "Baked Goods" one shelf -- and SQL cannot express that without
 * either a collation that only covers case or a second stored column. Doing
 * it in one place in JS keeps every path answering the same question; two
 * paths disagreeing about what matches is the bug this avoids.
 *
 * If the library ever grows past a few thousand rows this wants a join table
 * on the normalised key, not a bigger LIKE.
 */
export async function listRecipes(filters: LibraryFilters = {}): Promise<Recipe[]> {
  const db = await open();
  const where: string[] = [];
  const args: (string | number)[] = [];

  // A recipe in the Trash is not in the library. Every read filters it out
  // here rather than each screen remembering to: a deleted recipe surfacing
  // in search, on Home, or in a shopping list is the same bug four times.
  where.push("deleted_at IS NULL");

  for (const term of (filters.query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    where.push("search LIKE ?");
    args.push(`%${term}%`);
  }

  const rows = await db.getAllAsync<{ json: string }>(
    `SELECT json FROM recipes WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC`,
    args,
  );
  const recipes = rows.map((r) => JSON.parse(r.json) as Recipe);
  const wanted = filters.tags ?? [];
  const filtered = recipes.filter(
    (r) =>
      (!filters.category || sameCategory(r.category, filters.category)) &&
      wanted.every((t) => hasTag(r.tags, t)),
  );
  return filtered.sort(byNewest);
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  const db = await open();
  const row = await db.getFirstAsync<{ json: string }>(
    `SELECT json FROM recipes WHERE id = ? AND deleted_at IS NULL`, [id],
  );
  return row ? (JSON.parse(row.json) as Recipe) : null;
}

export async function countRecipes(): Promise<number> {
  const db = await open();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM recipes WHERE deleted_at IS NULL`,
  );
  return row?.n ?? 0;
}

// --- cooking progress ------------------------------------------------------

export async function getProgress(recipeId: string): Promise<CookProgress | null> {
  const db = await open();
  const row = await db.getFirstAsync<{ recipe_id: string; step_index: number; updated_at: number }>(
    `SELECT recipe_id, step_index, updated_at FROM cook_progress WHERE recipe_id = ?`,
    [recipeId],
  );
  return row ? { recipeId: row.recipe_id, stepIndex: row.step_index, updatedAt: row.updated_at } : null;
}

/** Remember which step the cook is on. Called on every step change. */
export async function saveProgress(recipeId: string, stepIndex: number): Promise<void> {
  const db = await open();
  await db.runAsync(
    `INSERT INTO cook_progress (recipe_id, step_index, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(recipe_id) DO UPDATE SET step_index = excluded.step_index, updated_at = excluded.updated_at`,
    [recipeId, stepIndex, Date.now()],
  );
}

export async function clearProgress(recipeId: string): Promise<void> {
  const db = await open();
  await db.runAsync(`DELETE FROM cook_progress WHERE recipe_id = ?`, [recipeId]);
}

/** Sessions left part-way through, most recent first. Home reads this. */
export async function activeSessions(limit = 3): Promise<CookProgress[]> {
  const db = await open();
  const rows = await db.getAllAsync<{ recipe_id: string; step_index: number; updated_at: number }>(
    `SELECT p.recipe_id, p.step_index, p.updated_at
       FROM cook_progress p
       JOIN recipes r ON r.id = p.recipe_id AND r.deleted_at IS NULL
      ORDER BY p.updated_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ recipeId: r.recipe_id, stepIndex: r.step_index, updatedAt: r.updated_at }));
}

/** How a recipe is currently being viewed. Display only: it never changes
 *  the stored recipe, so forgetting it loses a preference, not data. */
export type RecipeView = { scale: Scale; measurement: Measurement };

export const DEFAULT_VIEW: RecipeView = { scale: 1, measurement: "original" };

const VALID_SCALES = new Set([0.5, 1, 2, 3, 4]);
const VALID_MEASUREMENTS = new Set(["original", "us", "metric"]);

/**
 * The view saved for this recipe, or null when the cook has never set one.
 *
 * Null is the honest answer and the caller needs it: a recipe with a saved view
 * keeps it (a per-recipe decision outranks a global default), and a recipe
 * without one opens on the Settings default -- but only once that default has
 * been checked against what this particular recipe can offer. That check needs
 * the recipe, which this layer does not have. See openingMeasurement().
 */
export async function getRecipeView(recipeId: string): Promise<RecipeView | null> {
  const db = await open();
  const row = await db.getFirstAsync<{ scale: number; measurement: string }>(
    `SELECT scale, measurement FROM recipe_view WHERE recipe_id = ?`,
    [recipeId],
  );
  if (!row) return null;
  // Validate on read: a stored value from a later version, or a corrupted
  // row, must not put the interface into a state it cannot represent.
  const scale = VALID_SCALES.has(row.scale) ? (row.scale as Scale) : DEFAULT_VIEW.scale;
  const measurement = VALID_MEASUREMENTS.has(row.measurement)
    ? (row.measurement as Measurement)
    : DEFAULT_VIEW.measurement;
  return { scale, measurement };
}

export async function saveRecipeView(recipeId: string, view: RecipeView): Promise<void> {
  const db = await open();
  await db.runAsync(
    `INSERT INTO recipe_view (recipe_id, scale, measurement, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(recipe_id) DO UPDATE SET
       scale = excluded.scale, measurement = excluded.measurement, updated_at = excluded.updated_at`,
    [recipeId, view.scale, view.measurement, Date.now()],
  );
}

// --- shopping lists ----------------------------------------------------------

type ShoppingListRow = {
  id: string; title: string; sources: string; created_at: number; updated_at: number;
};
type ShoppingItemRow = {
  id: string; list_id: string; text: string; category: string; checked: number;
  origin: string; optional: number; warning: string | null; sources: string;
  position: number; created_at: number; updated_at: number;
};

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToList(r: ShoppingListRow): ShoppingList {
  const sources = parseJsonArray(r.sources).filter(
    (s): s is ShoppingListSource =>
      typeof s === "object" && s !== null && typeof (s as ShoppingListSource).recipeId === "string",
  );
  return {
    id: r.id,
    title: r.title,
    sources: sources.map((s) => ({ ...s, scale: parseScale(s.scale) })),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToItem(r: ShoppingItemRow): ShoppingItem {
  return {
    id: r.id,
    listId: r.list_id,
    text: r.text,
    category: r.category || "Uncategorized",
    checked: r.checked === 1,
    origin: r.origin === "manual" ? "manual" : "generated",
    optional: r.optional === 1,
    ...(r.warning ? { warning: r.warning } : {}),
    sources: parseJsonArray(r.sources).filter((x): x is string => typeof x === "string"),
    position: Number.isFinite(r.position) ? r.position : 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listShoppingLists(): Promise<ShoppingList[]> {
  const db = await open();
  const rows = await db.getAllAsync<ShoppingListRow>(
    `SELECT id, title, sources, created_at, updated_at FROM shopping_lists
      WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
  );
  return rows.map(rowToList);
}

export async function getShoppingList(id: string): Promise<ShoppingList | null> {
  const db = await open();
  const row = await db.getFirstAsync<ShoppingListRow>(
    `SELECT id, title, sources, created_at, updated_at FROM shopping_lists
      WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return row ? rowToList(row) : null;
}

export async function saveShoppingList(list: ShoppingList): Promise<void> {
  const db = await open();
  await db.runAsync(
    `INSERT INTO shopping_lists (id, title, sources, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, sources = excluded.sources, updated_at = excluded.updated_at,
       deleted_at = NULL`,
    [list.id, list.title, JSON.stringify(list.sources), list.createdAt, list.updatedAt],
  );
}

export async function deleteShoppingList(id: string, now = Date.now()): Promise<void> {
  const db = await open();
  // The list goes; its items go with it. Both soft, both recoverable.
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE shopping_lists SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now, now, id]);
    await db.runAsync(`UPDATE shopping_items SET deleted_at = ?, updated_at = ? WHERE list_id = ?`, [now, now, id]);
  });
}

export async function listShoppingItems(listId: string): Promise<ShoppingItem[]> {
  const db = await open();
  const rows = await db.getAllAsync<ShoppingItemRow>(
    `SELECT id, list_id, text, category, checked, origin, optional, warning, sources,
            position, created_at, updated_at
       FROM shopping_items
      WHERE list_id = ? AND deleted_at IS NULL
      ORDER BY position ASC`,
    [listId],
  );
  return rows.map(rowToItem);
}

/** How many items each list holds, and how many are ticked. One query rather
 *  than one per list, because the index screen shows every list. */
export async function shoppingListCounts(): Promise<Record<string, { done: number; total: number }>> {
  const db = await open();
  const rows = await db.getAllAsync<{ list_id: string; total: number; done: number }>(
    `SELECT list_id, COUNT(*) AS total, SUM(checked) AS done
       FROM shopping_items WHERE deleted_at IS NULL GROUP BY list_id`,
  );
  const out: Record<string, { done: number; total: number }> = {};
  for (const r of rows) out[r.list_id] = { done: r.done ?? 0, total: r.total ?? 0 };
  return out;
}

export async function saveShoppingItem(item: ShoppingItem): Promise<void> {
  const db = await open();
  await db.runAsync(
    `INSERT INTO shopping_items
       (id, list_id, text, category, checked, origin, optional, warning, sources, position, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       text = excluded.text, category = excluded.category, checked = excluded.checked,
       origin = excluded.origin, optional = excluded.optional, warning = excluded.warning,
       sources = excluded.sources, position = excluded.position,
       updated_at = excluded.updated_at, deleted_at = NULL`,
    [
      item.id, item.listId, item.text, item.category, item.checked ? 1 : 0,
      item.origin, item.optional ? 1 : 0, item.warning ?? null,
      JSON.stringify(item.sources), item.position, item.createdAt, item.updatedAt,
    ],
  );
}

export async function deleteShoppingItem(id: string, now = Date.now()): Promise<void> {
  const db = await open();
  await db.runAsync(
    `UPDATE shopping_items SET deleted_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, id],
  );
}

/**
 * Replace a list's generated items, keeping the cook's own.
 *
 * One transaction: a half-rebuilt list -- old items gone, new ones not yet
 * written -- is a list someone could be looking at in a shop.
 */
export async function replaceGeneratedItems(
  listId: string,
  items: readonly ShoppingItem[],
  now = Date.now(),
): Promise<void> {
  const db = await open();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE shopping_items SET deleted_at = ?, updated_at = ?
        WHERE list_id = ? AND origin = 'generated' AND deleted_at IS NULL`,
      [now, now, listId],
    );
    for (const item of items) {
      await db.runAsync(
        `INSERT INTO shopping_items
           (id, list_id, text, category, checked, origin, optional, warning, sources, position, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text, category = excluded.category, checked = excluded.checked,
           origin = excluded.origin, optional = excluded.optional, warning = excluded.warning,
           sources = excluded.sources, position = excluded.position,
           updated_at = excluded.updated_at, deleted_at = NULL`,
        [
          item.id, item.listId, item.text, item.category, item.checked ? 1 : 0,
          item.origin, item.optional ? 1 : 0, item.warning ?? null,
          JSON.stringify(item.sources), item.position, item.createdAt, item.updatedAt,
        ],
      );
    }
  });
}

// --- meal plan ---------------------------------------------------------------

type PlannedMealRow = {
  id: string; date: string; slot: string; recipe_id: string;
  scale: number; position: number; created_at: number; updated_at: number;
};

function rowToPlannedMeal(r: PlannedMealRow): PlannedMeal {
  // Validated on read, like every other stored shape: a row written by a later
  // version, or corrupted, must not reach the arithmetic that scales a
  // shopping list.
  return {
    id: r.id,
    date: isDateKey(r.date) ? r.date : toDateKey(new Date()),
    slot: parseSlot(r.slot),
    recipeId: r.recipe_id,
    scale: parseScale(r.scale),
    position: Number.isFinite(r.position) ? r.position : 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Every planned meal that has not been deleted.
 *
 * The whole plan, not a window: a library of meals is small (a year of three
 * meals a day is a thousand rows), the week strip needs counts for dates
 * outside the visible week, and the shopping list asks for arbitrary ranges.
 * Paging this would add a cache to save nothing.
 */
export async function listPlannedMeals(): Promise<PlannedMeal[]> {
  const db = await open();
  const rows = await db.getAllAsync<PlannedMealRow>(
    `SELECT id, date, slot, recipe_id, scale, position, created_at, updated_at
       FROM planned_meals
      WHERE deleted_at IS NULL
      ORDER BY date ASC, position ASC`,
  );
  return rows.map(rowToPlannedMeal);
}

export async function savePlannedMeal(meal: PlannedMeal): Promise<void> {
  const db = await open();
  await db.runAsync(
    `INSERT INTO planned_meals (id, date, slot, recipe_id, scale, position, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       date = excluded.date, slot = excluded.slot, recipe_id = excluded.recipe_id,
       scale = excluded.scale, position = excluded.position,
       updated_at = excluded.updated_at, deleted_at = NULL`,
    [
      meal.id, meal.date, meal.slot, meal.recipeId,
      meal.scale, meal.position, meal.createdAt, meal.updatedAt,
    ],
  );
}

/**
 * Remove a planned meal.
 *
 * Soft, per ADR 0006: the sync policy says a deletion loses to a concurrent
 * edit of the same element, which can only be decided if the deletion is
 * recorded rather than inferred from an absence. It also means an undo is a
 * row update away if one is ever wanted.
 */
export async function deletePlannedMeal(id: string, now = Date.now()): Promise<void> {
  const db = await open();
  await db.runAsync(
    `UPDATE planned_meals SET deleted_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, id],
  );
}

type TimerRow = {
  id: string; label: string; duration_ms: number;
  ends_at: number | null; remaining_ms: number | null;
  status: string; recipe_id: string | null; step_index: number | null;
  created_at: number;
};

const TIMER_STATUSES = new Set(["running", "paused", "done"]);

function rowToTimer(r: TimerRow): Timer {
  return {
    id: r.id,
    label: r.label,
    durationMs: r.duration_ms,
    endsAt: r.ends_at,
    remainingMs: r.remaining_ms,
    // A row with an unrecognised status is treated as finished rather than
    // dropped: losing a timer silently is worse than showing a spent one.
    status: (TIMER_STATUSES.has(r.status) ? r.status : "done") as Timer["status"],
    ...(r.recipe_id ? { recipeId: r.recipe_id } : {}),
    ...(r.step_index !== null ? { stepIndex: r.step_index } : {}),
    createdAt: r.created_at,
  };
}

export async function listTimers(): Promise<Timer[]> {
  const db = await open();
  const rows = await db.getAllAsync<TimerRow>(`SELECT * FROM timers ORDER BY created_at ASC`);
  return rows.map(rowToTimer);
}

export async function saveTimer(timer: Timer): Promise<void> {
  const db = await open();
  await db.runAsync(
    `INSERT INTO timers (id, label, duration_ms, ends_at, remaining_ms, status, recipe_id, step_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label, duration_ms = excluded.duration_ms,
       ends_at = excluded.ends_at, remaining_ms = excluded.remaining_ms,
       status = excluded.status, recipe_id = excluded.recipe_id,
       step_index = excluded.step_index`,
    [
      timer.id, timer.label, timer.durationMs,
      timer.endsAt ?? null, timer.remainingMs ?? null, timer.status,
      timer.recipeId ?? null, timer.stepIndex ?? null, timer.createdAt,
    ],
  );
}

export async function deleteTimer(id: string): Promise<void> {
  const db = await open();
  await db.runAsync(`DELETE FROM timers WHERE id = ?`, [id]);
}

/** Clear finished timers. Running and paused ones are left alone. */
export async function clearFinishedTimers(): Promise<void> {
  const db = await open();
  await db.runAsync(`DELETE FROM timers WHERE status = 'done'`);
}

/** Test and development helper. Not reachable from the UI. */
export async function resetForTesting(): Promise<void> {
  const db = await open();
  await db.execAsync(`DELETE FROM recipes; DELETE FROM cook_progress; DELETE FROM recipe_view; DELETE FROM timers; DELETE FROM planned_meals; DELETE FROM shopping_lists; DELETE FROM shopping_items; DELETE FROM meta;`);
  handle = null;
}
