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
import { hasTag, normalizeCategory, normalizeRecipeTags, sameCategory } from "../domain/tags";
import type { Scale } from "../domain/present";
import type { Timer } from "../domain/timer";
import { buildSearchText, byNewest, type LibraryFilters } from "./query";
import { SAMPLE_RECIPES } from "./sampleRecipes";

const DB_NAME = "recipebox.db";

/** Bump when the table shape changes; `migrate` is additive and idempotent. */
const SCHEMA_VERSION = 3;

let handle: Promise<SQLite.SQLiteDatabase> | null = null;

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
    CREATE TABLE IF NOT EXISTS recipe_view (
      recipe_id   TEXT PRIMARY KEY NOT NULL,
      scale       REAL NOT NULL,
      measurement TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );
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

async function upsert(db: SQLite.SQLiteDatabase, recipe: Recipe): Promise<void> {
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
      recipe.createdAt,
      recipe.updatedAt,
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
  await db.execAsync(`DELETE FROM recipes; DELETE FROM cook_progress; DELETE FROM recipe_view; DELETE FROM timers; DELETE FROM meta;`);
  handle = null;
}
