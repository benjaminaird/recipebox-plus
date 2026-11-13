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

const DB_NAME = "recipebox.db";

/**
 * Bump when the table shape changes; `migrate` is additive and idempotent.
 *
 * Every migration so far is a `CREATE TABLE IF NOT EXISTS`, which is why
 * upgrading has never cost a user a recipe: there is no path through this
 * function that drops, renames or rewrites an existing row. Keep it that way.
 * A change that genuinely cannot be expressed additively needs a copy-and-swap
 * with a test that proves the old rows arrived, not an ALTER in the dark.
 *
 * 4 — planned_meals (meal planning).
 * 5 — shopping_lists, shopping_items.
 * 6 — recipe_origin (where a recipe came from; see src/sync/pull.ts).
 */
const SCHEMA_VERSION = 6;

let handle: Promise<SQLite.SQLiteDatabase> | null = null;

/** The one handle. Exported so the sync store writes through the same
 *  migrations and the same connection as everything else. */
export function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  return open();
}

function open(): Promise<SQLite.SQLiteDatabase> {
  if (!handle) handle = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
    await migrate(db);
    await seedIfEmpty(db);
    return db;
  });
  return handle;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS recipes (
      id          TEXT PRIMARY KEY NOT NULL,
      title       TEXT NOT NULL,
      category    TEXT,
      tags        TEXT NOT NULL DEFAULT '[]',
      search      TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      json        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS recipes_created_at ON recipes (created_at DESC);
    CREATE TABLE IF NOT EXISTS cook_progress (
      recipe_id   TEXT PRIMARY KEY NOT NULL,
      step_index  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    -- Added in schema 2. How the cook chose to VIEW a recipe: the batch scale
    -- and the measurement system. Stored, not derived, because resuming a
    -- cooking session at 1x after someone set 2x would hand them the wrong
    -- quantities for a dish already in the oven.
    -- Added in schema 3. Timers outlive the app: a deadline is absolute, so
    -- a row written before a force-quit is still correct when it is read back,
    -- with no catching up to do.
    CREATE TABLE IF NOT EXISTS timers (
      id           TEXT PRIMARY KEY NOT NULL,
      label        TEXT NOT NULL,
      duration_ms  INTEGER NOT NULL,
      ends_at      INTEGER,
      remaining_ms INTEGER,
      status       TEXT NOT NULL,
      recipe_id    TEXT,
      step_index   INTEGER,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS timers_created_at ON timers (created_at);
    /* Meal planning.
     *
     * The shape is the one ADR 0006 can merge, even though sync is not built:
     * it specifies last-write-wins per day-and-meal slot, so each planned meal
     * carries its own stable id and its own updated_at rather than inheriting a
     * document-level timestamp. Deletes are soft (deleted_at), because that ADR
     * also says a deletion must lose to a concurrent edit -- which is only
     * decidable if the deletion is a row rather than an absence.
     *
     * The date column is TEXT in YYYY-MM-DD form: a calendar day, not an
     * instant. An epoch would move a meal across a timezone change or a
     * daylight-saving boundary; see domain/plan.ts. */
    CREATE TABLE IF NOT EXISTS planned_meals (
      id          TEXT PRIMARY KEY NOT NULL,
      date        TEXT NOT NULL,
      slot        TEXT NOT NULL,
      recipe_id   TEXT NOT NULL,
      scale       REAL NOT NULL DEFAULT 1,
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS planned_meals_date ON planned_meals (date);
    /* Shopping lists.
     *
     * Same sync-ready shape as planned_meals, for the same reason: ADR 0006
     * merges a shopping list as a UNION OF ITEMS, with checked state resolved
     * last-write-wins per item and a deletion that loses to a concurrent edit.
     * All three need per-item identity and per-item timestamps, so items are
     * rows with their own ids and their own updated_at, and nothing is hard
     * deleted.
     *
     * A list keeps its sources as JSON so the generated portion can be rebuilt
     * when a recipe is added. Items record whether they are generated or the
     * cook's own; see ItemOrigin in domain/shoppingList.ts for why editing a
     * generated line adopts it. */
    CREATE TABLE IF NOT EXISTS shopping_lists (
      id          TEXT PRIMARY KEY NOT NULL,
      title       TEXT NOT NULL,
      sources     TEXT NOT NULL DEFAULT '[]',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted_at  INTEGER
    );
    CREATE TABLE IF NOT EXISTS shopping_items (
      id          TEXT PRIMARY KEY NOT NULL,
      list_id     TEXT NOT NULL,
      text        TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'Uncategorized',
      checked     INTEGER NOT NULL DEFAULT 0,
      origin      TEXT NOT NULL DEFAULT 'generated',
      optional    INTEGER NOT NULL DEFAULT 0,
      warning     TEXT,
      sources     TEXT NOT NULL DEFAULT '[]',
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS shopping_items_list ON shopping_items (list_id);
    CREATE TABLE IF NOT EXISTS recipe_view (
      recipe_id   TEXT PRIMARY KEY NOT NULL,
      scale       REAL NOT NULL,
      measurement TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    -- Added in schema 6. Where a recipe came from, kept apart from what the
    -- recipe IS: nothing about sync is written into recipes.json, so losing
    -- this table costs bookkeeping and never a recipe.
    CREATE TABLE IF NOT EXISTS recipe_origin (
      recipe_id         TEXT PRIMARY KEY NOT NULL,
      origin            TEXT NOT NULL,
      account_id        TEXT,
      owner_id          TEXT,
      shared            INTEGER NOT NULL DEFAULT 0,
      server_id         TEXT,
      server_updated_at TEXT,
      pulled_at         TEXT
    );
    CREATE INDEX IF NOT EXISTS recipe_origin_account ON recipe_origin (account_id);
  `);
  await db.runAsync(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(SCHEMA_VERSION)],
  );
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

  const missing = SAMPLE_RECIPES.filter((r) => !seeded.includes(r.id));
  if (missing.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const recipe of missing) await upsert(db, recipe);
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
export async function saveRecipe(recipe: Recipe): Promise<void> {
  const db = await open();
  await upsert(db, {
    ...recipe,
    category: normalizeCategory(recipe.category),
    tags: normalizeRecipeTags(recipe.tags),
    updatedAt: recipe.updatedAt || Date.now(),
  });
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

  for (const term of (filters.query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    where.push("search LIKE ?");
    args.push(`%${term}%`);
  }

  const rows = await db.getAllAsync<{ json: string }>(
    `SELECT json FROM recipes ${where.length ? "WHERE " + where.join(" AND ") : ""}
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
  const row = await db.getFirstAsync<{ json: string }>(`SELECT json FROM recipes WHERE id = ?`, [id]);
  return row ? (JSON.parse(row.json) as Recipe) : null;
}

export async function countRecipes(): Promise<number> {
  const db = await open();
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM recipes`);
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
    `SELECT recipe_id, step_index, updated_at FROM cook_progress ORDER BY updated_at DESC LIMIT ?`,
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
