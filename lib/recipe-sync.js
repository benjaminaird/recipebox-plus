'use strict';

// The versioned write side of recipe synchronisation.
//
// The read side already existed and is unchanged (`readVisibleRecipesPage`).
// This is what a phone needs in order to send something back: a revision to
// cite, a way to be told "no" instead of overwriting, a history that keeps
// what it replaced, and a delete that can be undone.
//
// Three rules from ADR 0006 shape every function here, and they are worth
// stating before the code rather than after it:
//
//   Revisions, never clocks. A phone's clock is wrong, changes with
//   timezones, and can be set by its owner. A write cites the revision it
//   believed it was editing; if the server has moved on, that is a conflict.
//
//   Nothing is silently discarded. A conflict does not overwrite and does not
//   merge. The server refuses and hands back what it holds, so the client can
//   show a person two versions rather than invent a third.
//
//   Deletes are soft and outlive the Trash. A tombstone is a few bytes; a
//   resurrected recipe is somebody's dinner. The row stays, marked.
//
// ADR 0015 adds the fourth: every applied change appends a version, so the
// recipe a source published is still answerable for long after it is edited.

const crypto = require('crypto');

/** Causes a version row can record. Read as a story, not a list of timestamps. */
const VERSION_CAUSES = Object.freeze([
  'imported', 'edited', 'helper', 'resolved', 'conflict', 'reverted', 'deleted', 'restored',
]);

/**
 * Recipes the app seeds into every install.
 *
 * Every phone has these, with these exact ids, so an upload would mean two
 * devices claiming the same recipe — and the second one to sync would look
 * like a conflicting edit of the first one's dinner.
 *
 * The real guarantee is on the client: `planReconciliation` returns "never"
 * for anything whose origin is `sample`, and never offers it. This list is the
 * second lock on the same door, here because the cost of being wrong is
 * somebody's library and the cost of the check is a string comparison.
 */
const SAMPLE_RECIPE_IDS = Object.freeze(new Set([
  'brown-butter-chocolate-chip-cookies',
  'buttermilk-pancakes',
  'lemon-posset',
  'millionaires-shortbread',
  'roast-chicken-lemon-thyme',
  'tomato-white-bean-soup',
  'weeknight-tarka-dal',
]));

/** How long a tombstone is kept. Far longer than the 30-day Trash (ADR 0006). */
const TOMBSTONE_RETENTION_DAYS = 400;

/** How long a recipe stays in the Trash before it stops being offered back. */
const TRASH_DAYS = 30;

const MAX_WRITES_PER_PUSH = 100;
const DEFAULT_PULL_LIMIT = 200;
const MAX_PULL_LIMIT = 500;

// ---------------------------------------------------------------------------
// Decisions that need no database
// ---------------------------------------------------------------------------

/**
 * What a write should do, given what the client cited and what the server has.
 *
 * Separated from the SQL because this is the rule, and a rule that can only be
 * exercised by standing up PostgreSQL is a rule that gets tested once.
 *
 * `current` is null when the server has no such recipe.
 */
function classifyWrite(current, baseRevision) {
  if (!current) {
    // The client thinks it is editing something the server has never had. That
    // is not a create: it means the row was hard-deleted, or belongs to
    // somebody else, or the client is confused. Sending it as a create would
    // invent ownership.
    if (baseRevision !== null && baseRevision !== undefined) {
      return { status: 'conflict', reason: 'missing-on-server' };
    }
    return { status: 'apply', reason: 'create' };
  }

  if (baseRevision === null || baseRevision === undefined) {
    // A create for something that already exists. The client has never seen
    // the server's copy, so applying this would overwrite a version nobody on
    // that device has read.
    return { status: 'conflict', reason: 'already-exists' };
  }

  if (Number(baseRevision) !== Number(current.revision)) {
    return { status: 'conflict', reason: 'server-moved' };
  }

  if (current.deleted) {
    // Deleted on the server, edited here. ADR 0006 does not let a deletion
    // quietly take an edit with it, so this comes back for a person to decide.
    return { status: 'conflict', reason: 'deleted-on-server' };
  }

  return { status: 'apply', reason: 'update' };
}

/** The same question for a delete. */
function classifyDelete(current, baseRevision) {
  if (!current) return { status: 'skip', reason: 'already-gone' };
  if (current.deleted) return { status: 'skip', reason: 'already-deleted' };
  if (baseRevision === null || baseRevision === undefined) {
    return { status: 'conflict', reason: 'no-base' };
  }
  if (Number(baseRevision) !== Number(current.revision)) {
    return { status: 'conflict', reason: 'server-moved' };
  }
  return { status: 'apply', reason: 'delete' };
}

/** True for a recipe the app seeds and no account should ever own. */
function isSampleRecipeId(recipeId) {
  return SAMPLE_RECIPE_IDS.has(String(recipeId || '').trim());
}

/**
 * A key the server can recognise a retry by.
 *
 * The client sends one; this is the fallback for a client that does not, and
 * the shape the client's own `idempotencyKey` mirrors. Derived from what is
 * being sent, so the same change retried is the same key and a different
 * change is a different one.
 */
function deriveIdempotencyKey(input) {
  const material = [
    String(input.userId || ''),
    String(input.recipeId || ''),
    input.baseRevision === null || input.baseRevision === undefined ? 'new' : String(input.baseRevision),
    String(input.deviceId || ''),
    input.kind === 'delete' ? 'delete' : 'write',
    input.contentHash || '',
  ].join('\u0000');
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 40);
}

/** A stable hash of the recipe body, so a retry of the same edit matches. */
function recipeContentHash(recipe) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalForHash(recipe)))
    .digest('hex')
    .slice(0, 32);
}

function canonicalForHash(value) {
  if (Array.isArray(value)) return value.map(canonicalForHash);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalForHash(value[key]);
    return out;
  }
  return value;
}

function parsePullLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_PULL_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PULL_LIMIT) {
    throw new Error(`sync limit must be an integer between 1 and ${MAX_PULL_LIMIT}`);
  }
  return n;
}

function parseRevision(raw, label) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a non-negative integer`);
  return n;
}

// ---------------------------------------------------------------------------
// Schema. Additive: no column dropped, no existing value rewritten.
// ---------------------------------------------------------------------------

async function ensureSyncSchema(db) {
  await db.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS revision   bigint`);
  await db.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
  await db.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS deleted_by text`);
  await db.query(`CREATE INDEX IF NOT EXISTS recipes_sync_idx ON recipes (user_id, revision)`);
  await db.query(`CREATE INDEX IF NOT EXISTS recipes_recipe_id_idx ON recipes (user_id, (recipe_json->>'id'))`);

  // One monotonic counter per account. A client asks for "everything after N"
  // without a timestamp, because clocks are not evidence.
  await db.query(`
    CREATE TABLE IF NOT EXISTS account_revisions (
      user_id  text PRIMARY KEY,
      revision bigint NOT NULL DEFAULT 0
    )`);
  // The oldest revision a delta can still be trusted from. Whatever purges
  // tombstones raises this; until something does it stays 0 and every delta is
  // serviceable. Inferring the horizon from tombstones that still exist would
  // be exactly backwards: the check would start passing at the moment the
  // evidence was deleted, which is the moment it is needed.
  await db.query(
    `ALTER TABLE account_revisions ADD COLUMN IF NOT EXISTS tombstones_purged_before bigint NOT NULL DEFAULT 0`);

  // ADR 0015. Append-only: an edit adds a row and leaves earlier ones intact.
  await db.query(`
    CREATE TABLE IF NOT EXISTS recipe_versions (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Nullable, and SET NULL rather than CASCADE. The web's "replace my whole
      -- library" path deletes every row for an account and re-inserts it, and
      -- a cascade there would take the entire version history with it — the
      -- one thing ADR 0015 promises cannot happen. A version is identified by
      -- (user_id, recipe_id) anyway; the row id is a convenience.
      recipe_row_id uuid REFERENCES recipes(id) ON DELETE SET NULL,
      user_id       text NOT NULL,
      recipe_id     text NOT NULL,
      revision      bigint NOT NULL,
      recipe_json   jsonb NOT NULL,
      cause         text NOT NULL,
      device_id     text,
      created_at    timestamptz NOT NULL DEFAULT now()
    )`);
  await db.query(`CREATE INDEX IF NOT EXISTS recipe_versions_row_idx ON recipe_versions (recipe_row_id, revision DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS recipe_versions_user_idx ON recipe_versions (user_id, recipe_id, revision DESC)`);

  // A push that times out may or may not have been applied. The key lets a
  // retry be recognised rather than guessed at.
  await db.query(`
    CREATE TABLE IF NOT EXISTS sync_write_keys (
      user_id         text NOT NULL,
      idempotency_key text NOT NULL,
      recipe_id       text NOT NULL,
      revision        bigint NOT NULL,
      outcome         text NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, idempotency_key)
    )`);
  await db.query(`CREATE INDEX IF NOT EXISTS sync_write_keys_age_idx ON sync_write_keys (created_at)`);
}

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------

/**
 * Take the account's write lock for the rest of this transaction.
 *
 * Everything that assigns a revision does so under this lock, which is what
 * makes revisions a total order per account rather than a race. It is the same
 * lock `upsertUserRecipe` already takes, so the web and the phone serialise
 * against each other rather than only against themselves.
 */
async function lockAccount(client, userId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
}

/** The next revision for this account. Caller holds the lock. */
async function nextRevision(client, userId) {
  const result = await client.query(
    `INSERT INTO account_revisions (user_id, revision) VALUES ($1, 1)
       ON CONFLICT (user_id) DO UPDATE SET revision = account_revisions.revision + 1
     RETURNING revision`,
    [userId]
  );
  return Number(result.rows[0].revision);
}

async function currentAccountRevision(client, userId) {
  const result = await client.query('SELECT revision FROM account_revisions WHERE user_id = $1', [userId]);
  return result.rows[0] ? Number(result.rows[0].revision) : 0;
}

/**
 * Give every un-stamped row of this account a revision.
 *
 * Recipes saved before sync existed have `revision IS NULL`. Rather than a
 * migration sweeping every account's table, the first sync for an account
 * stamps its own rows, inside the lock it already holds. An account that never
 * syncs is never touched.
 *
 * Ordered by creation so the backfill reflects the order things were written,
 * which is the only ordering information those rows carry.
 */
async function backfillRevisions(client, userId) {
  const unstamped = await client.query(
    `SELECT id FROM recipes WHERE user_id = $1 AND revision IS NULL ORDER BY created_at ASC, id ASC`,
    [userId]
  );
  if (!unstamped.rows.length) return 0;
  for (const row of unstamped.rows) {
    const revision = await nextRevision(client, userId);
    await client.query('UPDATE recipes SET revision = $2 WHERE id = $1', [row.id, revision]);
  }
  return unstamped.rows.length;
}

// ---------------------------------------------------------------------------
// Reading what the server holds
// ---------------------------------------------------------------------------

/** The server's current state for one recipe of one owner, or null. */
async function readCurrent(client, userId, recipeId) {
  const result = await client.query(
    `SELECT id, revision, deleted_at, recipe_json, created_at
       FROM recipes
      WHERE user_id = $1 AND recipe_json->>'id' = $2
      FOR UPDATE`,
    [userId, recipeId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    rowId: row.id,
    revision: row.revision === null ? null : Number(row.revision),
    deleted: row.deleted_at !== null,
    deletedAt: row.deleted_at,
    recipe: row.recipe_json,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Apply one recipe write, or refuse it.
 *
 * Never partially applies: the caller runs this inside a transaction, and a
 * conflict returns rather than throwing so one refused write in a batch does
 * not roll back the ones that succeeded.
 */
async function applyWrite(client, input) {
  const {
    userId, recipe, baseRevision, idempotencyKey, deviceId = null, cause = 'edited',
  } = input;

  const recipeId = String((recipe && recipe.id) || '').trim();
  if (!recipeId) return { status: 'rejected', reason: 'missing-id', recipeId: null };
  if (isSampleRecipeId(recipeId)) {
    return { status: 'rejected', reason: 'sample-recipe', recipeId };
  }
  if (!VERSION_CAUSES.includes(cause)) {
    return { status: 'rejected', reason: 'unknown-cause', recipeId };
  }

  const repeat = await lookupIdempotencyKey(client, userId, idempotencyKey);
  if (repeat) return { ...repeat, repeated: true };

  const current = await readCurrent(client, userId, recipeId);
  const decision = classifyWrite(current, baseRevision);

  if (decision.status === 'conflict') {
    return {
      status: 'conflict',
      reason: decision.reason,
      recipeId,
      serverRevision: current ? current.revision : null,
      server: current ? current.recipe : null,
      serverDeleted: current ? current.deleted : false,
    };
  }

  const revision = await nextRevision(client, userId);
  let rowId;

  if (!current) {
    const inserted = await client.query(
      `INSERT INTO recipes (user_id, title, category, hero_image_url, recipe_json, favorite, rating, revision)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING id`,
      [
        userId,
        String(recipe.title || '').trim() || 'Untitled',
        recipe.category || null,
        recipe.heroImage || null,
        JSON.stringify(recipe),
        recipe.favorite === true,
        Number.isInteger(recipe.rating) ? recipe.rating : 0,
        revision,
      ]
    );
    rowId = inserted.rows[0].id;
  } else {
    rowId = current.rowId;
    await client.query(
      `UPDATE recipes
          SET title = $3, category = $4, hero_image_url = $5, recipe_json = $6::jsonb,
              favorite = $7, rating = $8, revision = $9, updated_at = now(),
              deleted_at = NULL, deleted_by = NULL
        WHERE id = $1 AND user_id = $2`,
      [
        rowId, userId,
        String(recipe.title || '').trim() || 'Untitled',
        recipe.category || null,
        recipe.heroImage || null,
        JSON.stringify(recipe),
        recipe.favorite === true,
        Number.isInteger(recipe.rating) ? recipe.rating : 0,
        revision,
      ]
    );
  }

  await appendVersion(client, {
    rowId, userId, recipeId, revision, recipe, cause, deviceId,
  });
  await rememberIdempotencyKey(client, userId, idempotencyKey, recipeId, revision, 'applied');

  return { status: 'applied', recipeId, revision, rowId, created: !current };
}

/**
 * Soft-delete a recipe.
 *
 * The row stays. ADR 0006 asks for tombstones that outlive the 30-day Trash by
 * a long way, because a device that has been offline for months and then
 * pushes its copy would otherwise resurrect what somebody deleted. A tombstone
 * is a few bytes and the alternative is a recipe coming back from the dead.
 */
async function applyDelete(client, input) {
  const { userId, recipeId, baseRevision, idempotencyKey, deviceId = null } = input;
  const id = String(recipeId || '').trim();
  if (!id) return { status: 'rejected', reason: 'missing-id', recipeId: null };

  const repeat = await lookupIdempotencyKey(client, userId, idempotencyKey);
  if (repeat) return { ...repeat, repeated: true };

  const current = await readCurrent(client, userId, id);
  const decision = classifyDelete(current, baseRevision);

  if (decision.status === 'conflict') {
    return {
      status: 'conflict',
      reason: decision.reason,
      recipeId: id,
      serverRevision: current ? current.revision : null,
      server: current ? current.recipe : null,
      serverDeleted: current ? current.deleted : false,
    };
  }
  if (decision.status === 'skip') {
    return { status: 'skipped', reason: decision.reason, recipeId: id, revision: current ? current.revision : null };
  }

  const revision = await nextRevision(client, userId);
  await client.query(
    `UPDATE recipes SET deleted_at = now(), deleted_by = $3, revision = $4, updated_at = now()
      WHERE id = $1 AND user_id = $2`,
    [current.rowId, userId, deviceId, revision]
  );
  // The version history records the delete as a version like any other, so
  // "what did this look like before it was thrown away" has an answer.
  await appendVersion(client, {
    rowId: current.rowId, userId, recipeId: id, revision,
    recipe: current.recipe, cause: 'deleted', deviceId,
  });
  await rememberIdempotencyKey(client, userId, idempotencyKey, id, revision, 'applied');

  return { status: 'applied', recipeId: id, revision, deleted: true };
}

/**
 * Bring a recipe back out of the Trash.
 *
 * Reverting and restoring both move forward: a new revision that re-states
 * earlier content, never a rewind. History is therefore never lost by undoing
 * (ADR 0015).
 */
async function restoreRecipe(client, input) {
  const { userId, recipeId, deviceId = null } = input;
  const id = String(recipeId || '').trim();
  const current = await readCurrent(client, userId, id);
  if (!current) return { status: 'rejected', reason: 'not-found', recipeId: id };
  if (!current.deleted) {
    return { status: 'skipped', reason: 'not-deleted', recipeId: id, revision: current.revision };
  }

  const revision = await nextRevision(client, userId);
  await client.query(
    `UPDATE recipes SET deleted_at = NULL, deleted_by = NULL, revision = $3, updated_at = now()
      WHERE id = $1 AND user_id = $2`,
    [current.rowId, userId, revision]
  );
  await appendVersion(client, {
    rowId: current.rowId, userId, recipeId: id, revision,
    recipe: current.recipe, cause: 'restored', deviceId,
  });
  return { status: 'applied', recipeId: id, revision, restored: true };
}

/**
 * Restore an earlier version as the current one.
 *
 * Appends rather than rewinds, for the same reason as above: a revert that
 * deleted history would make the second revert impossible.
 */
async function revertToVersion(client, input) {
  const { userId, recipeId, targetRevision, deviceId = null } = input;
  const id = String(recipeId || '').trim();
  const current = await readCurrent(client, userId, id);
  if (!current) return { status: 'rejected', reason: 'not-found', recipeId: id };

  const found = await client.query(
    `SELECT recipe_json FROM recipe_versions
      WHERE user_id = $1 AND recipe_id = $2 AND revision = $3
      ORDER BY created_at DESC LIMIT 1`,
    [userId, id, targetRevision]
  );
  if (!found.rows.length) return { status: 'rejected', reason: 'no-such-version', recipeId: id };

  const recipe = found.rows[0].recipe_json;
  const revision = await nextRevision(client, userId);
  await client.query(
    `UPDATE recipes
        SET title = $3, category = $4, hero_image_url = $5, recipe_json = $6::jsonb,
            revision = $7, updated_at = now(), deleted_at = NULL, deleted_by = NULL
      WHERE id = $1 AND user_id = $2`,
    [
      current.rowId, userId,
      String(recipe.title || '').trim() || 'Untitled',
      recipe.category || null,
      recipe.heroImage || null,
      JSON.stringify(recipe),
      revision,
    ]
  );
  await appendVersion(client, {
    rowId: current.rowId, userId, recipeId: id, revision, recipe, cause: 'reverted', deviceId,
  });
  return { status: 'applied', recipeId: id, revision, revertedTo: Number(targetRevision) };
}

/**
 * Record a version for a write that came from the browser.
 *
 * The web's save path predates all of this and passes a recipe rather than a
 * recipe id, so this is the same append with the id taken from the body. It
 * exists so a recipe edited in a browser has the same history as one edited on
 * a phone — ADR 0015 is about the recipe, not about which client touched it.
 */
async function recordWebVersion(client, { rowId, userId, recipe, revision, cause }) {
  const recipeId = String((recipe && recipe.id) || '').trim();
  if (!recipeId) return;
  await appendVersion(client, {
    rowId, userId, recipeId, revision, recipe,
    cause: VERSION_CAUSES.includes(cause) ? cause : 'edited',
    deviceId: null,
  });
}

async function appendVersion(client, { rowId, userId, recipeId, revision, recipe, cause, deviceId }) {
  await client.query(
    `INSERT INTO recipe_versions (recipe_row_id, user_id, recipe_id, revision, recipe_json, cause, device_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [rowId, userId, recipeId, revision, JSON.stringify(recipe), cause, deviceId]
  );
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

async function lookupIdempotencyKey(client, userId, key) {
  if (!key) return null;
  const result = await client.query(
    `SELECT recipe_id, revision, outcome FROM sync_write_keys WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, String(key)]
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  return { status: row.outcome, recipeId: row.recipe_id, revision: Number(row.revision) };
}

async function rememberIdempotencyKey(client, userId, key, recipeId, revision, outcome) {
  if (!key) return;
  await client.query(
    `INSERT INTO sync_write_keys (user_id, idempotency_key, recipe_id, revision, outcome)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
    [userId, String(key), recipeId, revision, outcome]
  );
}

// ---------------------------------------------------------------------------
// Pulling a delta
// ---------------------------------------------------------------------------

/**
 * Everything this account has changed since `since`.
 *
 * Deletions come back separately from recipes, because a client that only
 * reads the recipe list would never learn that something is gone — and a
 * delete the client never hears about is a delete that comes back.
 *
 * A `since` older than the tombstone horizon cannot be served as a delta: the
 * server may have forgotten deletions this client still needs to be told
 * about. It is told to start again instead of being quietly lied to.
 */
async function readChangesSince(client, input) {
  const { userId, since, limit = DEFAULT_PULL_LIMIT } = input;
  const head = await currentAccountRevision(client, userId);

  if (since !== null && since !== undefined && since > 0) {
    const watermark = await client.query(
      'SELECT tombstones_purged_before FROM account_revisions WHERE user_id = $1', [userId]);
    const purgedBefore = watermark.rows[0] ? Number(watermark.rows[0].tombstones_purged_before) : 0;
    if (since < purgedBefore) {
      // This client's watermark predates deletions the server no longer
      // remembers. A delta would omit them and the client would push its copies
      // back, resurrecting recipes somebody deleted — the specific failure
      // ADR 0006 names. Start again instead.
      return { resyncRequired: true, revision: head, recipes: [], deletions: [], more: false };
    }
  }

  const from = since === null || since === undefined ? 0 : Number(since);
  const rows = await client.query(
    `SELECT id, revision, deleted_at, recipe_json, created_at, updated_at
       FROM recipes
      WHERE user_id = $1 AND revision IS NOT NULL AND revision > $2
      ORDER BY revision ASC
      LIMIT $3`,
    [userId, from, limit + 1]
  );

  const more = rows.rows.length > limit;
  const page = more ? rows.rows.slice(0, limit) : rows.rows;

  const recipes = [];
  const deletions = [];
  for (const row of page) {
    if (row.deleted_at !== null) {
      deletions.push({
        id: row.recipe_json && row.recipe_json.id,
        revision: Number(row.revision),
        deletedAt: new Date(row.deleted_at).toISOString(),
      });
    } else {
      recipes.push({
        recipe: row.recipe_json,
        serverId: row.id,
        revision: Number(row.revision),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      });
    }
  }

  return {
    recipes,
    deletions,
    // The watermark is the highest revision actually sent, so a client that
    // stops early resumes where it stopped rather than skipping the rest.
    revision: page.length ? Number(page[page.length - 1].revision) : from,
    headRevision: head,
    more,
    resyncRequired: false,
  };
}

/**
 * Forget tombstones older than the retention horizon, and record that we have.
 *
 * Nothing calls this yet — retention is a policy, not a cron job somebody has
 * to remember — but the watermark it maintains is what makes a long-offline
 * client detectable rather than guessed at, so the two belong together.
 */
async function purgeTombstones(client, userId, retentionDays = TOMBSTONE_RETENTION_DAYS) {
  const doomed = await client.query(
    `SELECT id, revision FROM recipes
      WHERE user_id = $1 AND deleted_at IS NOT NULL
        AND deleted_at < now() - ($2 || ' days')::interval`,
    [userId, String(retentionDays)]
  );
  if (!doomed.rows.length) return { purged: 0, watermark: null };

  const highest = Math.max(...doomed.rows.map((r) => Number(r.revision)));
  await client.query(
    `DELETE FROM recipes WHERE id = ANY($1::uuid[])`,
    [doomed.rows.map((r) => r.id)]
  );
  // Anything syncing from at or before the highest forgotten revision can no
  // longer be served a delta.
  await client.query(
    `INSERT INTO account_revisions (user_id, revision, tombstones_purged_before)
     VALUES ($1, 0, $2)
       ON CONFLICT (user_id) DO UPDATE
       SET tombstones_purged_before = GREATEST(account_revisions.tombstones_purged_before, $2)`,
    [userId, highest + 1]
  );
  return { purged: doomed.rows.length, watermark: highest + 1 };
}

/** What is in the Trash and still offerable back. */
async function listTrash(client, userId) {
  const result = await client.query(
    `SELECT recipe_json, revision, deleted_at
       FROM recipes
      WHERE user_id = $1 AND deleted_at IS NOT NULL
        AND deleted_at > now() - ($2 || ' days')::interval
      ORDER BY deleted_at DESC`,
    [userId, String(TRASH_DAYS)]
  );
  return result.rows.map((row) => ({
    recipe: row.recipe_json,
    revision: Number(row.revision),
    deletedAt: new Date(row.deleted_at).toISOString(),
  }));
}

/** The history of one recipe, newest first. */
async function readVersions(client, userId, recipeId, limit = 50) {
  const result = await client.query(
    `SELECT revision, cause, created_at, device_id
       FROM recipe_versions
      WHERE user_id = $1 AND recipe_id = $2
      ORDER BY revision DESC
      LIMIT $3`,
    [userId, String(recipeId), limit]
  );
  return result.rows.map((row) => ({
    revision: Number(row.revision),
    cause: row.cause,
    at: new Date(row.created_at).toISOString(),
    deviceId: row.device_id,
  }));
}

module.exports = {
  VERSION_CAUSES,
  SAMPLE_RECIPE_IDS,
  TOMBSTONE_RETENTION_DAYS,
  TRASH_DAYS,
  MAX_WRITES_PER_PUSH,
  DEFAULT_PULL_LIMIT,
  MAX_PULL_LIMIT,
  classifyWrite,
  classifyDelete,
  isSampleRecipeId,
  deriveIdempotencyKey,
  recipeContentHash,
  parsePullLimit,
  parseRevision,
  ensureSyncSchema,
  lockAccount,
  nextRevision,
  currentAccountRevision,
  backfillRevisions,
  readCurrent,
  applyWrite,
  applyDelete,
  restoreRecipe,
  revertToVersion,
  readChangesSince,
  listTrash,
  readVersions,
  purgeTombstones,
  recordWebVersion,
};
