// The PullStore, backed by the device's SQLite database.
//
// Thin on purpose: every decision that could lose a recipe lives in
// src/sync/pull.ts, which is tested without a database. What is here is the
// writing down, and the one thing worth care — the recipe and its provenance
// go in together or not at all, so a crash cannot leave a recipe on the device
// that nothing knows the origin of.

import * as SQLite from "expo-sqlite";
import { activeLocalStore, openDatabase, upsertRecipeRow } from "./db";
import { envelopeTimes } from "../sync/pull.ts";
import type { PullStore, RecipeOrigin, Origin } from "../sync/pull.ts";

function toOrigin(row: {
  recipe_id: string; origin: string; account_id: string | null; owner_id: string | null;
  shared: number; server_updated_at: string | null; pulled_at: string | null;
}): RecipeOrigin {
  return {
    recipeId: row.recipe_id,
    origin: row.origin as Origin,
    accountId: row.account_id,
    ownerId: row.owner_id,
    shared: row.shared === 1,
    serverUpdatedAt: row.server_updated_at,
    pulledAt: row.pulled_at,
  };
}

const cursorKey = (accountId: string) => "sync_cursor:" + accountId;
const syncedKey = (accountId: string) => "sync_last_at:" + accountId;

/**
 * @param expectedStore the local library this account may write to, as
 * `src/auth/localStore.ts` resolved it. Required, and checked before every
 * write: a guard that is skipped when the caller passes nothing is a guard
 * that protects the paths which already knew what they were doing and lets
 * through the ones that did not.
 */
export function sqlitePullStore(expectedStore: string): PullStore {
  /**
   * The library this write is allowed to touch, checked immediately before it
   * happens — and again after the handle is open, because opening is
   * asynchronous and a sign-in can land in between. The file a write actually
   * arrives at is the only one worth asserting about.
   */
  const assertOwnLibrary = (): void => {
    if (!expectedStore) throw new Error("no library resolved for this account; refusing to write");
    if (activeLocalStore() !== expectedStore) {
      throw new Error("refusing to write into a different library than this account's");
    }
  };

  return {
    async seededIds() {
      const db = await openDatabase();
      const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'seeded_ids'");
      if (!row?.value) return [];
      try {
        const parsed: unknown = JSON.parse(row.value);
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
      } catch {
        return [];
      }
    },

    async getOrigin(recipeId) {
      const db = await openDatabase();
      const row = await db.getFirstAsync<Parameters<typeof toOrigin>[0]>(
        "SELECT recipe_id, origin, account_id, owner_id, shared, server_updated_at, pulled_at FROM recipe_origin WHERE recipe_id = ?",
        recipeId,
      );
      return row ? toOrigin(row) : null;
    },

    async putCloudRecipe({ envelope, accountId }) {
      assertOwnLibrary();
      const db = await openDatabase();
      assertOwnLibrary();
      // Together or not at all. A recipe stored without its provenance would
      // look local on the next pull and be refused for ever after.
      await db.withTransactionAsync(async () => {
        await upsertRecipeRow(db, envelope.recipe, envelopeTimes(envelope));
        await db.runAsync(
          `INSERT INTO recipe_origin (recipe_id, origin, account_id, owner_id, shared, server_id, server_updated_at, pulled_at)
           VALUES (?, 'cloud', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(recipe_id) DO UPDATE SET
             origin = 'cloud', account_id = excluded.account_id, owner_id = excluded.owner_id,
             shared = excluded.shared, server_id = excluded.server_id,
             server_updated_at = excluded.server_updated_at, pulled_at = excluded.pulled_at`,
          [
            envelope.recipe.id, accountId, envelope.ownerId, envelope.shared ? 1 : 0,
            envelope.serverId, envelope.updatedAt, new Date().toISOString(),
          ],
        );
      });
    },

    async getCursor(accountId) {
      const db = await openDatabase();
      const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = ?", cursorKey(accountId));
      return row?.value ? row.value : null;
    },

    async setCursor(accountId, cursor) {
      assertOwnLibrary();
      const db = await openDatabase();
      assertOwnLibrary();
      if (cursor === null) {
        await db.runAsync("DELETE FROM meta WHERE key = ?", cursorKey(accountId));
        return;
      }
      await db.runAsync(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [cursorKey(accountId), cursor],
      );
    },

    async setLastSyncedAt(accountId, syncedAt) {
      assertOwnLibrary();
      const db = await openDatabase();
      assertOwnLibrary();
      await db.runAsync(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [syncedKey(accountId), syncedAt],
      );
    },
  };
}

/**
 * Mark a recipe as made on this device.
 *
 * Called after an import or a hand-written recipe is saved. It matters for one
 * reason: a recipe with no provenance row would be indistinguishable from one
 * a pull had never seen, and the upload stage decides what to offer by exactly
 * this field. Writing it down at the moment of creation is how a local recipe
 * stays recognisably local.
 */
export async function markRecipeLocal(recipeId: string): Promise<void> {
  const db = await openDatabase();
  await db.runAsync(
    `INSERT INTO recipe_origin (recipe_id, origin, shared)
     VALUES (?, 'local', 0)
     ON CONFLICT(recipe_id) DO NOTHING`,
    recipeId,
  );
}

/** What the app shows: when this account last finished a pull. */
export async function lastSyncedAt(accountId: string): Promise<string | null> {
  const db = await openDatabase();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = ?", syncedKey(accountId));
  return row?.value ?? null;
}

/** Recipes on this device that came from nowhere but this device. */
export async function localOnlyRecipeIds(): Promise<string[]> {
  const db = await openDatabase();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT r.id FROM recipes r
      LEFT JOIN recipe_origin o ON o.recipe_id = r.id
     WHERE o.recipe_id IS NULL OR o.origin = 'local'`,
  );
  return rows.map((r) => r.id);
}

export type { SQLite };
