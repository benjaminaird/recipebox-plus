// The coordinator's SyncStore, written down in SQLite.
//
// Thin on purpose, in the same way src/data/syncStore.ts is thin: every rule
// about what may be uploaded, what a conflict means and what happens after a
// failure lives in src/sync/coordinator.ts and src/sync/outbox.ts, both of
// which are pure and both of which are tested without a database. What is here
// is the writing down — and the one thing that genuinely belongs to storage,
// which is that a change and the promise to send it land together or not at
// all.
//
// It takes the database handle rather than opening one, so the same code runs
// against Expo's SQLite on the phone and against node:sqlite in a test. The
// tables are real either way, which is the point: a store tested against a
// hand-written fake proves the fake works.

import type { Recipe } from "./types.ts";
import type { SyncStore, LocalRecipeRow } from "../sync/coordinator.ts";
import type { ConflictRecord, OutboxEntry } from "../sync/outbox.ts";
import { enqueue } from "../sync/outbox.ts";
import type { ConflictResolution } from "../sync/outbox.ts";
import { envelopeTimes } from "../sync/pull.ts";
import type { Origin } from "../sync/pull.ts";
import type { LocalRecipeChange } from "./db.ts";
import { buildSearchText } from "./query.ts";

/**
 * The slice of the database driver this module uses.
 *
 * Declared here rather than imported from expo-sqlite because nothing in this
 * file needs anything else, and a narrow dependency is what lets the tests use
 * a real SQLite that is not Expo's.
 */
export type SqliteLike = {
  getFirstAsync<T>(sql: string, args?: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, args?: unknown[]): Promise<T[]>;
  runAsync(sql: string, args?: unknown[]): Promise<unknown>;
  withTransactionAsync(body: () => Promise<void>): Promise<void>;
};

/**
 * Which local library this write is allowed to touch.
 *
 * Every method the store returns has always checked this. The three exported
 * functions below did not, and that was an inconsistency rather than a
 * decision: they are reached from the provider while a sign-in may be in
 * flight, and opening a library is asynchronous, so the file a write arrives
 * at is not necessarily the one the caller had in mind when it started. The
 * recorder in particular runs on EVERY save, which is the busiest path there
 * is. They take the same guard now.
 */
export type LibraryGuard = {
  /** The library this account may write to, as src/auth/localStore.ts resolved it. */
  expected: string;
  /** The library actually open, read at the moment of the write. */
  active: () => string | null;
};

function assertLibrary(guard: LibraryGuard | undefined): void {
  if (!guard) return;
  if (!guard.expected) throw new Error("no library resolved for this account; refusing to write");
  if (guard.active() !== guard.expected) {
    throw new Error("refusing to write into a different library than this account's");
  }
}

const watermarkKey = (accountId: string) => "sync_revision:" + accountId;
const lastRunKey = (accountId: string) => "sync_last_run:" + accountId;

type OutboxRow = {
  recipe_id: string; account_id: string; kind: string; base_revision: number | null;
  idempotency_key: string; recipe_json: string | null; attempts: number;
  next_attempt_at: number; queued_at: number; last_error: string | null;
};

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    recipeId: row.recipe_id,
    kind: row.kind === "delete" ? "delete" : "write",
    baseRevision: row.base_revision,
    idempotencyKey: row.idempotency_key,
    recipe: row.recipe_json ? (JSON.parse(row.recipe_json) as Recipe) : null,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    queuedAt: row.queued_at,
    lastError: row.last_error,
  };
}

type OriginRow = {
  recipe_id: string; origin: string; adopted: number; server_revision: number | null;
  deleted_at: number | null;
};

function toLocalRow(row: OriginRow): LocalRecipeRow {
  return {
    recipeId: row.recipe_id,
    origin: (row.origin === "cloud" || row.origin === "sample" ? row.origin : "local") as Origin,
    adopted: row.adopted === 1 || row.origin === "cloud",
    serverRevision: row.server_revision,
    deletedLocally: row.deleted_at !== null,
  };
}

/**
 * A fresh idempotency key.
 *
 * Random rather than derived from the recipe: two edits that happen to produce
 * identical bodies are still two changes, and a key that collided between them
 * would let the server answer the second with the first's outcome. Retries
 * reuse the key already on the row, which is where the safety actually comes
 * from.
 */
function newKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Refuse to write provenance over another account's.
 *
 * recipe_origin's primary key is the recipe id alone, so every upsert here is
 * `ON CONFLICT(recipe_id) DO UPDATE SET account_id = excluded.account_id` —
 * which takes the row over if it belonged to someone else. That was harmless
 * while the reads were unscoped, because a foreign row was simply found and
 * respected. Scoping the reads by account made the row INVISIBLE instead, so
 * the code concluded there was no provenance and wrote its own: a read that
 * sees less than the write touches is how an access check comes to protect
 * nothing.
 *
 * Deliberately unscoped, because the question is "whose is this row", and a
 * query that cannot see the other account's row cannot answer it.
 *
 * Each account has its own database file, so this cannot happen today. It
 * throws rather than silently skipping, because a recipe whose provenance was
 * quietly not written is one that will be treated as new for ever after.
 */
async function assertOriginOwner(
  db: SqliteLike, recipeId: string, accountId: string,
): Promise<void> {
  const row = await db.getFirstAsync<{ account_id: string | null }>(
    `SELECT account_id FROM recipe_origin WHERE recipe_id = ?`, [recipeId],
  );
  if (row && row.account_id !== null && row.account_id !== accountId) {
    throw new Error("refusing to take over another account's recipe");
  }
}

async function writeEntry(db: SqliteLike, accountId: string, entry: OutboxEntry): Promise<void> {
  // recipe_id is the primary key, so an upsert would quietly rewrite
  // account_id if a row for this recipe belonged to someone else — and that
  // account's promise to send a change would vanish with no trace. Each
  // account has its own database file, so it cannot happen; a guard that says
  // so out loud is better than an upsert that would silently do the wrong
  // thing if the file boundary ever moved. Refusing is honest. Taking the row
  // over, or dropping the write with a WHERE clause, would not be.
  const owner = await db.getFirstAsync<{ account_id: string }>(
    `SELECT account_id FROM sync_outbox WHERE recipe_id = ?`, [entry.recipeId],
  );
  if (owner && owner.account_id !== accountId) {
    throw new Error("refusing to overwrite another account's queued change");
  }
  await db.runAsync(
    `INSERT INTO sync_outbox
       (recipe_id, account_id, kind, base_revision, idempotency_key, recipe_json,
        attempts, next_attempt_at, queued_at, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(recipe_id) DO UPDATE SET
       account_id = excluded.account_id, kind = excluded.kind,
       base_revision = excluded.base_revision, idempotency_key = excluded.idempotency_key,
       recipe_json = excluded.recipe_json, attempts = excluded.attempts,
       next_attempt_at = excluded.next_attempt_at, queued_at = excluded.queued_at,
       last_error = excluded.last_error`,
    [
      entry.recipeId, accountId, entry.kind, entry.baseRevision, entry.idempotencyKey,
      entry.recipe ? JSON.stringify(entry.recipe) : null,
      entry.attempts, entry.nextAttemptAt, entry.queuedAt, entry.lastError,
    ],
  );
}

/**
 * Fold one local change into the queue, using the same rules as everywhere
 * else.
 *
 * `enqueue` from outbox.ts does the deciding — a delete swallowing a pending
 * write, the earliest base revision winning, a create-then-delete vanishing —
 * applied to the single row for this recipe rather than to a whole array. The
 * rules are not restated here; restating them is how two code paths come to
 * disagree about what the queue means.
 *
 * Returns what is now queued, or null if nothing is.
 */
export async function queueLocalChange(
  db: SqliteLike,
  accountId: string,
  change: LocalRecipeChange,
  now = Date.now(),
  guard?: LibraryGuard,
): Promise<OutboxEntry | null> {
  assertLibrary(guard);
  const existingRow = await db.getFirstAsync<OutboxRow>(
    `SELECT * FROM sync_outbox WHERE recipe_id = ? AND account_id = ?`,
    [change.recipeId, accountId],
  );
  // Scoped to this account, and to rows that belong to no account yet: a
  // recipe adopted by somebody else is not adopted by us, and reading their
  // server_revision would cite a revision from an account we cannot see.
  // Within one database file per account this cannot arise — the query says
  // so anyway, because the file boundary is an arrangement and this is the
  // rule the arrangement exists to produce.
  const origin = await db.getFirstAsync<OriginRow>(
    `SELECT o.recipe_id, o.origin, o.adopted, o.server_revision, r.deleted_at
       FROM recipe_origin o LEFT JOIN recipes r ON r.id = o.recipe_id
      WHERE o.recipe_id = ? AND (o.account_id IS NULL OR o.account_id = ?)`,
    [change.recipeId, accountId],
  );

  // A sample is never queued, however it was changed. Every install ships the
  // same ids, so an uploaded sample is two phones claiming one recipe.
  if (origin?.origin === "sample") return null;

  const cloud = origin?.origin === "cloud";
  const adopted = cloud || origin?.adopted === 1;

  if (!adopted && !change.created) {
    // On the phone before this account was. Reconciled deliberately from the
    // Account screen, not by having been edited.
    return null;
  }

  if (change.created && !origin) {
    // Written into this account's own library while signed in: it is this
    // account's recipe, and recording that is what makes it uploadable.
    await assertOriginOwner(db, change.recipeId, accountId);
    await db.runAsync(
      `INSERT INTO recipe_origin (recipe_id, origin, account_id, shared, adopted)
       VALUES (?, 'local', ?, 0, 1)
       ON CONFLICT(recipe_id) DO UPDATE SET account_id = excluded.account_id, adopted = 1`,
      [change.recipeId, accountId],
    );
  }

  const queue = existingRow ? [toEntry(existingRow)] : [];
  const next = enqueue(queue, {
    recipeId: change.recipeId,
    kind: change.kind,
    recipe: change.recipe,
    baseRevision: origin?.server_revision ?? null,
    idempotencyKey: newKey(),
    now,
  });

  if (!next.length) {
    // A create that was deleted before it was ever sent. The server never
    // heard of it, so there is nothing to tell it.
    await db.runAsync(
      `DELETE FROM sync_outbox WHERE recipe_id = ? AND account_id = ?`,
      [change.recipeId, accountId],
    );
    return null;
  }
  await writeEntry(db, accountId, next[0]);
  return next[0];
}

/**
 * Put a local recipe into the account, at the cook's explicit request.
 *
 * The one path by which a recipe that predates the sign-in becomes something
 * this device will upload. It is deliberately separate from editing, and
 * deliberately refuses samples.
 */
export async function adoptRecipe(
  db: SqliteLike, accountId: string, recipeId: string, now = Date.now(),
  guard?: LibraryGuard,
): Promise<boolean> {
  let adopted = false;
  await db.withTransactionAsync(async () => {
    assertLibrary(guard);
    const row = await db.getFirstAsync<{ origin: string; json: string }>(
      `SELECT COALESCE(o.origin, 'local') AS origin, r.json
         FROM recipes r LEFT JOIN recipe_origin o ON o.recipe_id = r.id
        WHERE r.id = ? AND r.deleted_at IS NULL
          AND (o.account_id IS NULL OR o.account_id = ?)`,
      [recipeId, accountId],
    );
    if (!row || row.origin === "sample") return;
    await assertOriginOwner(db, recipeId, accountId);
    await db.runAsync(
      `INSERT INTO recipe_origin (recipe_id, origin, account_id, shared, adopted)
       VALUES (?, 'local', ?, 0, 1)
       ON CONFLICT(recipe_id) DO UPDATE SET account_id = excluded.account_id, adopted = 1`,
      [recipeId, accountId],
    );
    await queueLocalChange(
      db, accountId,
      { recipeId, kind: "write", recipe: JSON.parse(row.json) as Recipe, created: false },
      now, guard,
    );
    adopted = true;
  });
  return adopted;
}

/** Recipes on this phone that this account has not taken on. */
export async function unadoptedRecipes(db: SqliteLike, accountId: string): Promise<Recipe[]> {
  const rows = await db.getAllAsync<{ json: string }>(
    `SELECT r.json FROM recipes r
       LEFT JOIN recipe_origin o ON o.recipe_id = r.id
        AND (o.account_id IS NULL OR o.account_id = ?)
      WHERE r.deleted_at IS NULL
        AND COALESCE(o.origin, 'local') = 'local'
        AND COALESCE(o.adopted, 0) = 0
      ORDER BY r.created_at DESC`,
    [accountId],
  );
  return rows.map((r) => JSON.parse(r.json) as Recipe);
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

export type StoredConflict = ConflictRecord & { id: string; resolution: string | null };

type ConflictRow = {
  id: string; recipe_id: string; kind: string | null;
  mine_json: string | null; theirs_json: string | null;
  server_revision: number | null; reason: string; detected_at: number;
  resolved_at: number | null; resolution: string | null;
};

function toConflict(row: ConflictRow): StoredConflict {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    kind: row.kind === "delete" ? "delete" : "write",
    mine: row.mine_json ? (JSON.parse(row.mine_json) as Recipe) : null,
    theirs: row.theirs_json ? (JSON.parse(row.theirs_json) as Recipe) : null,
    serverRevision: row.server_revision,
    reason: row.reason,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  };
}

/** Conflicts still waiting on a person, oldest first. */
export async function listOpenConflicts(db: SqliteLike, accountId: string): Promise<StoredConflict[]> {
  const rows = await db.getAllAsync<ConflictRow>(
    `SELECT * FROM sync_conflicts WHERE account_id = ? AND resolved_at IS NULL ORDER BY detected_at ASC`,
    [accountId],
  );
  return rows.map(toConflict);
}

export async function countOpenConflicts(db: SqliteLike, accountId: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sync_conflicts WHERE account_id = ? AND resolved_at IS NULL`,
    [accountId],
  );
  return row?.n ?? 0;
}

export async function countQueued(db: SqliteLike, accountId: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sync_outbox WHERE account_id = ?`, [accountId],
  );
  return row?.n ?? 0;
}

/** When this account last finished a run, as an epoch millisecond. */
export async function lastRunAt(db: SqliteLike, accountId: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = ?`, [lastRunKey(accountId)],
  );
  const n = row?.value ? Number(row.value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function setLastRunAt(db: SqliteLike, accountId: string, at: number): Promise<void> {
  await db.runAsync(
    `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [lastRunKey(accountId), String(at)],
  );
}

// ---------------------------------------------------------------------------
// The store the coordinator sees
// ---------------------------------------------------------------------------

/**
 * @param expectedStore the local library this account may write to, as
 * src/auth/localStore.ts resolved it. Checked before and after every write,
 * for the reason syncStore.ts gives: opening is asynchronous, so a sign-in can
 * land between deciding to write and writing, and the file a write actually
 * arrives at is the only one worth asserting about.
 */
export function sqliteSyncStore(
  db: SqliteLike,
  accountId: string,
  expectedStore: string,
  activeStore: () => string | null,
): SyncStore {
  const guard: LibraryGuard = { expected: expectedStore, active: activeStore };
  const assertOwnLibrary = (): void => assertLibrary(guard);

  return {
    accountId: () => accountId,

    async getWatermark() {
      const row = await db.getFirstAsync<{ value: string }>(
        `SELECT value FROM meta WHERE key = ?`, [watermarkKey(accountId)],
      );
      const n = row?.value ? Number(row.value) : 0;
      return Number.isFinite(n) && n >= 0 ? n : 0;
    },

    async setWatermark(revision) {
      assertOwnLibrary();
      await db.runAsync(
        `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [watermarkKey(accountId), String(revision)],
      );
    },

    async getLocal(recipeId) {
      const row = await db.getFirstAsync<OriginRow>(
        `SELECT o.recipe_id, o.origin, COALESCE(o.adopted, 0) AS adopted,
                o.server_revision, r.deleted_at
           FROM recipe_origin o LEFT JOIN recipes r ON r.id = o.recipe_id
          WHERE o.recipe_id = ?`,
        [recipeId],
      );
      if (row) return toLocalRow(row);
      // No provenance row, but the recipe is here: written on this phone
      // before any of this existed. Local, and not adopted.
      const recipe = await db.getFirstAsync<{ id: string; deleted_at: number | null }>(
        `SELECT id, deleted_at FROM recipes WHERE id = ?`, [recipeId],
      );
      if (!recipe) return null;
      return {
        recipeId, origin: "local", adopted: false, serverRevision: null,
        deletedLocally: recipe.deleted_at !== null,
      };
    },

    async putRemote({ envelope, revision }) {
      assertOwnLibrary();
      const times = envelopeTimes(envelope);
      const recipe = envelope.recipe;
      // The recipe and its provenance go in together. A recipe stored without
      // its revision would be uploaded next time as if it were new.
      await db.withTransactionAsync(async () => {
        // Inside, not before: a check that runs outside the transaction it
        // guards is a check another write can slip past.
        await assertOriginOwner(db, recipe.id, accountId);
        await db.runAsync(
          `INSERT INTO recipes (id, title, category, tags, search, created_at, updated_at, json, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title, category = excluded.category, tags = excluded.tags,
             search = excluded.search, updated_at = excluded.updated_at,
             json = excluded.json, deleted_at = NULL`,
          [
            recipe.id, recipe.title, recipe.category ?? null,
            JSON.stringify(recipe.tags ?? []), buildSearchText(recipe),
            times.createdAt, times.updatedAt, JSON.stringify(recipe),
          ],
        );
        await db.runAsync(
          `INSERT INTO recipe_origin
             (recipe_id, origin, account_id, owner_id, shared, server_id, server_updated_at, pulled_at,
              server_revision, adopted)
           VALUES (?, 'cloud', ?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(recipe_id) DO UPDATE SET
             origin = 'cloud', account_id = excluded.account_id, owner_id = excluded.owner_id,
             shared = excluded.shared, server_id = excluded.server_id,
             server_updated_at = excluded.server_updated_at, pulled_at = excluded.pulled_at,
             server_revision = excluded.server_revision, adopted = 1`,
          [
            recipe.id, accountId, envelope.ownerId, envelope.shared ? 1 : 0,
            envelope.serverId, envelope.updatedAt, new Date().toISOString(), revision,
          ],
        );
      });
    },

    async applyRemoteDeletion(recipeId, revision) {
      assertOwnLibrary();
      // Soft, like every other deletion here. The server's Trash and this
      // phone's are the same Trash as far as the cook is concerned, and a row
      // that is still here is one they can have back.
      //
      // Scoped to a recipe this account actually got from the cloud. A
      // deletion is the most destructive thing the server can ask of this
      // device, so it is the last place to take the recipe id on trust: a
      // local recipe, or another account's, is not the server's to delete.
      await db.withTransactionAsync(async () => {
        await assertOriginOwner(db, recipeId, accountId);
        const mine = await db.getFirstAsync<{ recipe_id: string }>(
          `SELECT recipe_id FROM recipe_origin
            WHERE recipe_id = ? AND account_id = ? AND origin = 'cloud'`,
          [recipeId, accountId],
        );
        if (!mine) return;
        await db.runAsync(
          `UPDATE recipes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
          [Date.now(), recipeId],
        );
        await db.runAsync(`DELETE FROM cook_progress WHERE recipe_id = ?`, [recipeId]);
        await db.runAsync(
          `UPDATE recipe_origin SET server_revision = ? WHERE recipe_id = ? AND account_id = ?`,
          [revision, recipeId, accountId],
        );
      });
    },

    async clearCloudRecipes() {
      assertOwnLibrary();
      // Everything that came from the account goes, so a full resync can put
      // it back — EXCEPT anything this device still owes the server. A resync
      // is a bookkeeping problem; discarding an edit nobody has sent yet would
      // turn it into lost work, which is the one outcome none of this is
      // allowed to produce.
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `DELETE FROM recipes WHERE id IN (
             SELECT o.recipe_id FROM recipe_origin o
              WHERE o.origin = 'cloud'
                AND o.account_id = ?
                AND o.recipe_id NOT IN (SELECT recipe_id FROM sync_outbox WHERE account_id = ?)
           )`,
          [accountId, accountId],
        );
        await db.runAsync(
          `DELETE FROM recipe_origin
            WHERE origin = 'cloud' AND account_id = ?
              AND recipe_id NOT IN (SELECT recipe_id FROM sync_outbox WHERE account_id = ?)`,
          [accountId, accountId],
        );
      });
    },

    async listOutbox() {
      const rows = await db.getAllAsync<OutboxRow>(
        `SELECT * FROM sync_outbox WHERE account_id = ? ORDER BY queued_at ASC`, [accountId],
      );
      return rows.map(toEntry);
    },

    async removeFromOutbox(recipeId) {
      assertOwnLibrary();
      await db.runAsync(
        `DELETE FROM sync_outbox WHERE recipe_id = ? AND account_id = ?`, [recipeId, accountId],
      );
    },

    async updateOutboxEntry(entry) {
      assertOwnLibrary();
      // Only if it is still there. A failure handler that re-inserted a row
      // the same run had already removed would resurrect a change the server
      // has answered.
      const present = await db.getFirstAsync<{ recipe_id: string }>(
        `SELECT recipe_id FROM sync_outbox WHERE recipe_id = ? AND account_id = ?`,
        [entry.recipeId, accountId],
      );
      if (!present) return;
      await writeEntry(db, accountId, entry);
    },

    async markSynced(recipeId, revision, deleted) {
      assertOwnLibrary();
      await db.withTransactionAsync(async () => {
        await assertOriginOwner(db, recipeId, accountId);
        await db.runAsync(
          `INSERT INTO recipe_origin (recipe_id, origin, account_id, shared, server_revision, adopted)
           VALUES (?, 'cloud', ?, 0, ?, 1)
           ON CONFLICT(recipe_id) DO UPDATE SET
             origin = 'cloud', account_id = excluded.account_id,
             server_revision = excluded.server_revision, adopted = 1`,
          [recipeId, accountId, revision],
        );
        if (deleted) {
          await db.runAsync(
            `UPDATE recipes SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?`,
            [Date.now(), recipeId],
          );
        }
      });
    },

    async recordConflict(conflict) {
      assertOwnLibrary();
      await db.runAsync(
        `INSERT INTO sync_conflicts
           (id, recipe_id, account_id, kind, mine_json, theirs_json, server_revision, reason,
            detected_at, resolved_at, resolution)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        [
          conflict.recipeId + ":" + conflict.detectedAt,
          conflict.recipeId, accountId, conflict.kind,
          conflict.mine ? JSON.stringify(conflict.mine) : null,
          conflict.theirs ? JSON.stringify(conflict.theirs) : null,
          conflict.serverRevision, conflict.reason, conflict.detectedAt,
        ],
      );
    },
  };
}

/**
 * Carry out what the cook chose.
 *
 * The choosing is `resolve` in outbox.ts, which is pure and tested; this is
 * the writing down of its answer, in one transaction so a conflict cannot end
 * up marked resolved with neither the copy nor the queued change to show for
 * it.
 */
export async function applyResolution(
  db: SqliteLike,
  accountId: string,
  conflict: StoredConflict,
  resolution: ConflictResolution,
  now = Date.now(),
  guard?: LibraryGuard,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    assertLibrary(guard);
    await db.runAsync(
      `UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE id = ? AND account_id = ?`,
      [resolution.conflict.resolvedAt ?? now, resolutionName(resolution), conflict.id, accountId],
    );

    if (resolution.create) {
      const copy = resolution.create;
      await db.runAsync(
        `INSERT INTO recipes (id, title, category, tags, search, created_at, updated_at, json, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, category = excluded.category, tags = excluded.tags,
           search = excluded.search, updated_at = excluded.updated_at,
           json = excluded.json, deleted_at = NULL`,
        [
          copy.id, copy.title, copy.category ?? null, JSON.stringify(copy.tags ?? []),
          buildSearchText(copy), copy.createdAt, copy.updatedAt, JSON.stringify(copy),
        ],
      );
      // The copy is this account's: it was made here, deliberately, while
      // signed in, which is the same thing that makes any new recipe theirs.
      await assertOriginOwner(db, copy.id, accountId);
      await db.runAsync(
        `INSERT INTO recipe_origin (recipe_id, origin, account_id, shared, adopted)
         VALUES (?, 'local', ?, 0, 1)
         ON CONFLICT(recipe_id) DO UPDATE SET account_id = excluded.account_id, adopted = 1`,
        [copy.id, accountId],
      );
    }

    if (resolution.enqueue) {
      const queued = resolution.enqueue;
      await writeEntry(db, accountId, {
        recipeId: queued.recipeId,
        kind: queued.kind,
        baseRevision: queued.baseRevision,
        idempotencyKey: newKey(),
        recipe: queued.recipe,
        attempts: 0,
        nextAttemptAt: 0,
        queuedAt: now,
        lastError: null,
      });
    }
  });
}

function resolutionName(resolution: ConflictResolution): string {
  if (resolution.create) return "keep-both";
  return resolution.enqueue ? "keep-mine" : "keep-theirs";
}

/**
 * Taking a recipe out of the Trash after choosing the account's version.
 *
 * Keeping the account's copy of a recipe this device deleted means the
 * deletion does not happen — so the row must come back out of the Trash, or
 * the cook is told the account's version won, and the recipe is still gone
 * from their library.
 */
export async function undeleteLocally(db: SqliteLike, recipeId: string): Promise<void> {
  await db.runAsync(`UPDATE recipes SET deleted_at = NULL WHERE id = ?`, [recipeId]);
}
