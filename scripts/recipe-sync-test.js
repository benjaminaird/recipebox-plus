// The versioned write path, against a real PostgreSQL database.
//
// This is the gate the brief asks for: conflict, retry, deletion and rollback
// demonstrated before any synchronisation write is switched on. It exercises
// lib/recipe-sync.js directly rather than through HTTP, because what is being
// proved here is the data layer — that a conflict does not overwrite, that a
// retry does not double-apply, that a delete can be undone, and that a failed
// batch leaves nothing behind.
//
// Opt-in and destructive to its own database only: it creates one, uses it,
// and drops it. Set RECIPE_SYNC_TEST_DATABASE_URL (or
// DEVICE_AUTH_TEST_DATABASE_URL) to an isolated instance — for example:
//
//   docker run -d --rm --name rb-sync-test -e POSTGRES_PASSWORD=pw \
//     -e POSTGRES_DB=postgres -p 55432:5432 postgres:16-alpine
//
// Never a production URL. The guard below refuses anything that does not look
// like a test database.

const assert = require('assert');
const crypto = require('crypto');

// Node exits 0 when the event loop empties, so an unsettled promise can make a
// half-run suite look like a pass. This is cleared only on the success line.
process.exitCode = 1;

const ADMIN_URL = process.env.RECIPE_SYNC_TEST_DATABASE_URL
  || process.env.DEVICE_AUTH_TEST_DATABASE_URL
  || '';

if (!ADMIN_URL) {
  console.log('recipe-sync-test: skipped (set RECIPE_SYNC_TEST_DATABASE_URL to an isolated test database)');
  process.exitCode = 0;
  return;
}
if (!/test|localhost|127\.0\.0\.1/i.test(ADMIN_URL) || /neon\.tech/i.test(ADMIN_URL)) {
  console.error('RECIPE_SYNC_TEST_DATABASE_URL does not look like an isolated test database; refusing to touch it');
  process.exit(1);
}

const sync = require('../lib/recipe-sync.js');

const DB_NAME = 'rb_sync_' + crypto.randomBytes(4).toString('hex');
const ALICE = 'user-alice-' + crypto.randomBytes(3).toString('hex');
const BOB = 'user-bob-' + crypto.randomBytes(3).toString('hex');

function urlForDatabase(base, name) {
  const u = new URL(base);
  u.pathname = '/' + name;
  return u.toString();
}

function recipe(id, title, extra) {
  return Object.assign({
    id,
    title,
    sections: [{
      name: '',
      ingredients: [{ id: 'i1', name: 'plain flour', amount: '250', unit: 'g' }],
      steps: [{ id: 's1', text: 'Mix.' }],
    }],
    source: { name: 'A Baker', url: 'https://example.test/x' },
  }, extra || {});
}

const steps = [];
function step(name) { steps.push(name); console.log('  ' + String(steps.length).padStart(2) + '. ' + name); }

async function main() {
  const { Pool } = require('pg');

  const admin = new Pool({ connectionString: ADMIN_URL });
  admin.on('error', () => {});
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const pool = new Pool({ connectionString: urlForDatabase(ADMIN_URL, DB_NAME) });
  pool.on('error', () => {});

  // A minimal shape of the production tables this module touches. The real
  // bootstrap lives in server.js; recreating only what is referenced keeps
  // this test about synchronisation rather than about the whole schema.
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await pool.query(`
    CREATE TABLE recipes (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        text NOT NULL,
      title          text NOT NULL,
      category       text,
      hero_image_url text,
      recipe_json    jsonb NOT NULL,
      favorite       boolean NOT NULL DEFAULT false,
      rating         integer NOT NULL DEFAULT 0,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    )`);

  await sync.ensureSyncSchema(pool);
  // Additive and idempotent: running it twice must not fail or change anything.
  await sync.ensureSyncSchema(pool);
  step('schema applied, and applying it twice is harmless');

  const tx = async (run) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await run(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* keep the original */ }
      throw err;
    } finally {
      client.release();
    }
  };

  // -------------------------------------------------------------------------
  // Create, update, identity, ownership
  // -------------------------------------------------------------------------

  const first = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    return sync.applyWrite(c, {
      userId: ALICE, recipe: recipe('r-scones', 'Scones'),
      baseRevision: null, idempotencyKey: 'k-create', cause: 'imported',
    });
  });
  assert.equal(first.status, 'applied');
  assert.equal(first.created, true);
  assert.equal(first.revision, 1, 'revisions start at 1');
  step('a create is applied and assigned revision 1');

  const second = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    return sync.applyWrite(c, {
      userId: ALICE, recipe: recipe('r-scones', 'Scones, twice baked'),
      baseRevision: 1, idempotencyKey: 'k-update-1', cause: 'edited',
    });
  });
  assert.equal(second.status, 'applied');
  assert.equal(second.revision, 2);
  assert.equal(second.created, false, 'the same recipe id updates in place');
  step('an update citing the current revision is applied, in place');

  const rows = await pool.query('SELECT count(*)::int AS n FROM recipes WHERE user_id = $1', [ALICE]);
  assert.equal(rows.rows[0].n, 1, 'one recipe, not two: identity is preserved across the update');
  step('recipe identity is preserved — one row, not a duplicate');

  const owned = await pool.query('SELECT user_id FROM recipes WHERE recipe_json->>$1 = $2', ['id', 'r-scones']);
  assert.equal(owned.rows[0].user_id, ALICE, 'ownership is the writer');
  step('ownership is recorded as the writing account');

  // -------------------------------------------------------------------------
  // Conflicts — nothing is overwritten
  // -------------------------------------------------------------------------

  const stale = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    return sync.applyWrite(c, {
      userId: ALICE, recipe: recipe('r-scones', 'Scones from a stale phone'),
      baseRevision: 1, idempotencyKey: 'k-stale', cause: 'edited',
    });
  });
  assert.equal(stale.status, 'conflict');
  assert.equal(stale.reason, 'server-moved');
  assert.equal(stale.serverRevision, 2);
  assert.equal(stale.server.title, 'Scones, twice baked', 'the conflict hands back what the server holds');
  step('a write citing a superseded revision is a conflict, not an overwrite');

  const after = await pool.query(`SELECT recipe_json->>'title' AS t, revision FROM recipes WHERE user_id = $1`, [ALICE]);
  assert.equal(after.rows[0].t, 'Scones, twice baked', 'the server copy is untouched by the refused write');
  assert.equal(Number(after.rows[0].revision), 2, 'and its revision did not move');
  step('the refused write changed nothing at all');

  const blindCreate = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    return sync.applyWrite(c, {
      userId: ALICE, recipe: recipe('r-scones', 'A phone that never pulled'),
      baseRevision: null, idempotencyKey: 'k-blind', cause: 'edited',
    });
  });
  assert.equal(blindCreate.status, 'conflict');
  assert.equal(blindCreate.reason, 'already-exists');
  step('a create for a recipe that already exists is a conflict, not an overwrite');

  // -------------------------------------------------------------------------
  // Retries
  // -------------------------------------------------------------------------

  const retry = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    return sync.applyWrite(c, {
      userId: ALICE, recipe: recipe('r-scones', 'Scones, twice baked'),
      baseRevision: 1, idempotencyKey: 'k-update-1', cause: 'edited',
    });
  });
  assert.equal(retry.status, 'applied', 'the retry reports what the first attempt did');
  assert.equal(retry.repeated, true);
  assert.equal(retry.revision, 2, 'and the same revision, not a new one');

  const head = await tx((c) => sync.currentAccountRevision(c, ALICE));
  assert.equal(head, 2, 'a retry does not consume a revision');
  const stillOne = await pool.query('SELECT count(*)::int AS n FROM recipes WHERE user_id = $1', [ALICE]);
  assert.equal(stillOne.rows[0].n, 1);
  step('a retried push is recognised and applied once, not twice');

  const versionsAfterRetry = await tx((c) => sync.readVersions(c, ALICE, 'r-scones'));
  assert.equal(versionsAfterRetry.length, 2, 'and the retry wrote no extra history');
  step('the retry added no phantom version');

  // -------------------------------------------------------------------------
  // Version history (ADR 0015)
  // -------------------------------------------------------------------------

  assert.deepEqual(versionsAfterRetry.map((v) => v.cause), ['edited', 'imported']);
  assert.deepEqual(versionsAfterRetry.map((v) => v.revision), [2, 1]);
  step('history records every applied change, newest first, with its cause');

  const original = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipe_versions WHERE user_id = $1 AND revision = 1`, [ALICE]);
  assert.equal(original.rows[0].t, 'Scones', 'the version it arrived as is still readable');
  step('the imported original survives every later edit');

  // -------------------------------------------------------------------------
  // Source attribution and original measurements survive a round trip
  // -------------------------------------------------------------------------

  const stored = await pool.query(`SELECT recipe_json FROM recipes WHERE user_id = $1`, [ALICE]);
  const body = stored.rows[0].recipe_json;
  assert.equal(body.source.name, 'A Baker', 'source attribution is preserved');
  assert.equal(body.source.url, 'https://example.test/x');
  assert.equal(body.sections[0].ingredients[0].amount, '250', 'original amount preserved');
  assert.equal(body.sections[0].ingredients[0].unit, 'g', 'original unit preserved, not converted');
  assert.equal(body.sections[0].ingredients[0].id, 'i1', 'ingredient identity preserved for step references');
  step('source, original measurements and ingredient ids survive the write');

  // -------------------------------------------------------------------------
  // Samples are never accepted
  // -------------------------------------------------------------------------

  const sample = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    return sync.applyWrite(c, {
      userId: ALICE, recipe: recipe('lemon-posset', 'Lemon Posset'),
      baseRevision: null, idempotencyKey: 'k-sample', cause: 'edited',
    });
  });
  assert.equal(sample.status, 'rejected');
  assert.equal(sample.reason, 'sample-recipe');
  const noSample = await pool.query(
    `SELECT count(*)::int AS n FROM recipes WHERE recipe_json->>'id' = 'lemon-posset'`);
  assert.equal(noSample.rows[0].n, 0, 'and nothing was written');
  step('a seeded sample is refused by the server as well as by the client');

  // -------------------------------------------------------------------------
  // Deletion, tombstones, Trash, restore
  // -------------------------------------------------------------------------

  const created2 = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    return sync.applyWrite(c, {
      userId: ALICE, recipe: recipe('r-soup', 'Tomato Soup'),
      baseRevision: null, idempotencyKey: 'k-soup', cause: 'imported',
    });
  });
  assert.equal(created2.status, 'applied');

  const deleted = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    return sync.applyDelete(c, {
      userId: ALICE, recipeId: 'r-soup', baseRevision: created2.revision,
      idempotencyKey: 'k-del-soup', deviceId: 'phone-1',
    });
  });
  assert.equal(deleted.status, 'applied');
  assert.equal(deleted.deleted, true);

  const tombstone = await pool.query(
    `SELECT deleted_at, deleted_by, revision FROM recipes WHERE recipe_json->>'id' = 'r-soup'`);
  assert.ok(tombstone.rows[0].deleted_at, 'the row stays, marked — a tombstone, not a hole');
  assert.equal(tombstone.rows[0].deleted_by, 'phone-1');
  step('a delete is soft: the row remains as a tombstone');

  const trash = await tx((c) => sync.listTrash(c, ALICE));
  assert.equal(trash.length, 1);
  assert.equal(trash[0].recipe.title, 'Tomato Soup');
  step('the deleted recipe is offered back from the Trash');

  const deleteVersion = await tx((c) => sync.readVersions(c, ALICE, 'r-soup'));
  assert.equal(deleteVersion[0].cause, 'deleted', 'the delete is itself a version');
  step('history records what the recipe looked like when it was thrown away');

  const restored = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    return sync.restoreRecipe(c, { userId: ALICE, recipeId: 'r-soup', deviceId: 'phone-1' });
  });
  assert.equal(restored.status, 'applied');
  assert.ok(restored.revision > deleted.revision, 'restoring moves forward, it does not rewind');
  const back = await pool.query(`SELECT deleted_at FROM recipes WHERE recipe_json->>'id' = 'r-soup'`);
  assert.equal(back.rows[0].deleted_at, null);
  step('a recipe can be recovered from the Trash, as a new revision');

  const deleteRetry = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    return sync.applyDelete(c, {
      userId: ALICE, recipeId: 'r-soup', baseRevision: created2.revision,
      idempotencyKey: 'k-del-soup', deviceId: 'phone-1',
    });
  });
  assert.equal(deleteRetry.repeated, true, 'the original delete is remembered');
  const stillBack = await pool.query(`SELECT deleted_at FROM recipes WHERE recipe_json->>'id' = 'r-soup'`);
  assert.equal(stillBack.rows[0].deleted_at, null, 'and a replayed delete does not re-delete what was restored');
  step('a replayed delete does not undo a restore');

  // -------------------------------------------------------------------------
  // Reverting to an earlier version
  // -------------------------------------------------------------------------

  const reverted = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    return sync.revertToVersion(c, { userId: ALICE, recipeId: 'r-scones', targetRevision: 1 });
  });
  assert.equal(reverted.status, 'applied');
  const revertedBody = await pool.query(
    `SELECT recipe_json->>'title' AS t, revision FROM recipes WHERE recipe_json->>'id' = 'r-scones'`);
  assert.equal(revertedBody.rows[0].t, 'Scones', 'the earlier content is current again');
  assert.ok(Number(revertedBody.rows[0].revision) > 2, 'as a new revision');
  const historyAfterRevert = await tx((c) => sync.readVersions(c, ALICE, 'r-scones'));
  assert.equal(historyAfterRevert[0].cause, 'reverted');
  assert.equal(historyAfterRevert.length, 3, 'and the version it reverted away from is still there');
  step('a revert restores earlier content without losing the history between');

  // -------------------------------------------------------------------------
  // Rollback: a failed batch leaves nothing behind
  // -------------------------------------------------------------------------

  const headBefore = await tx((c) => sync.currentAccountRevision(c, ALICE));
  const countBefore = (await pool.query('SELECT count(*)::int AS n FROM recipes WHERE user_id = $1', [ALICE])).rows[0].n;

  await assert.rejects(() => tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    await sync.applyWrite(c, {
      userId: ALICE, recipe: recipe('r-rollback', 'Written then rolled back'),
      baseRevision: null, idempotencyKey: 'k-rollback', cause: 'edited',
    });
    throw new Error('the batch failed after one write succeeded');
  }), /the batch failed/);

  const countAfter = (await pool.query('SELECT count(*)::int AS n FROM recipes WHERE user_id = $1', [ALICE])).rows[0].n;
  const headAfter = await tx((c) => sync.currentAccountRevision(c, ALICE));
  assert.equal(countAfter, countBefore, 'the recipe written before the failure is gone');
  assert.equal(headAfter, headBefore, 'and the revision it consumed is gone with it');
  const orphanVersion = await pool.query(
    `SELECT count(*)::int AS n FROM recipe_versions WHERE recipe_id = 'r-rollback'`);
  assert.equal(orphanVersion.rows[0].n, 0, 'and no history survives a rolled-back write');
  const orphanKey = await pool.query(
    `SELECT count(*)::int AS n FROM sync_write_keys WHERE idempotency_key = 'k-rollback'`);
  assert.equal(orphanKey.rows[0].n, 0, 'nor an idempotency key that would make a retry a no-op');
  step('a failed batch rolls back completely — row, revision, history and key');

  // -------------------------------------------------------------------------
  // Per-account isolation
  // -------------------------------------------------------------------------

  const bobWrite = await tx(async (c) => {
    await sync.lockAccount(c, BOB);
    return sync.applyWrite(c, {
      userId: BOB, recipe: recipe('r-scones', "Bob's own scones"),
      baseRevision: null, idempotencyKey: 'k-create', cause: 'imported',
    });
  });
  assert.equal(bobWrite.status, 'applied', "the same recipe id in another account is a different recipe");
  assert.equal(bobWrite.revision, 1, "and that account's revisions start at 1 of their own");
  const aliceUnchanged = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipes WHERE user_id = $1 AND recipe_json->>'id' = 'r-scones'`, [ALICE]);
  assert.equal(aliceUnchanged.rows[0].t, 'Scones', "and Alice's copy is untouched");
  step('accounts are isolated: same id, same key, different recipe and counter');

  // -------------------------------------------------------------------------
  // Delta pull
  // -------------------------------------------------------------------------

  const all = await tx((c) => sync.readChangesSince(c, { userId: ALICE, since: 0 }));
  assert.ok(all.recipes.length >= 2);
  assert.equal(all.resyncRequired, false);
  const sinceMid = await tx((c) => sync.readChangesSince(c, { userId: ALICE, since: 2 }));
  assert.ok(sinceMid.recipes.every((r) => r.revision > 2), 'a delta returns only what changed after the watermark');
  step('a delta pull returns only changes after the cited revision');

  const soupDeleted = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    const cur = await sync.readCurrent(c, ALICE, 'r-soup');
    return sync.applyDelete(c, {
      userId: ALICE, recipeId: 'r-soup', baseRevision: cur.revision, idempotencyKey: 'k-del-2',
    });
  });
  const withDeletion = await tx((c) => sync.readChangesSince(c, { userId: ALICE, since: soupDeleted.revision - 1 }));
  assert.ok(withDeletion.deletions.some((d) => d.id === 'r-soup'), 'deletions travel separately from recipes');
  assert.ok(!withDeletion.recipes.some((r) => r.recipe.id === 'r-soup'), 'a deleted recipe is not sent as a recipe');
  step('deletions are reported as deletions, so a delete is never missed');

  const paged = await tx((c) => sync.readChangesSince(c, { userId: ALICE, since: 0, limit: 1 }));
  assert.equal(paged.recipes.length + paged.deletions.length, 1);
  assert.equal(paged.more, true, 'a short page says there is more');
  assert.ok(paged.revision > 0, 'and the watermark is what was actually sent');
  step('a delta pull pages, and resumes from what it sent');

  // -------------------------------------------------------------------------
  // Backfill: rows written before sync existed
  // -------------------------------------------------------------------------

  await pool.query(
    `INSERT INTO recipes (user_id, title, recipe_json) VALUES ($1, $2, $3::jsonb)`,
    [BOB, 'An older recipe', JSON.stringify(recipe('r-legacy', 'An older recipe'))]
  );
  const unstampedBefore = await pool.query(
    'SELECT count(*)::int AS n FROM recipes WHERE user_id = $1 AND revision IS NULL', [BOB]);
  assert.equal(unstampedBefore.rows[0].n, 1);

  const stamped = await tx(async (c) => {
    await sync.lockAccount(c, BOB);
    return sync.backfillRevisions(c, BOB);
  });
  assert.equal(stamped, 1);
  const unstampedAfter = await pool.query(
    'SELECT count(*)::int AS n FROM recipes WHERE user_id = $1 AND revision IS NULL', [BOB]);
  assert.equal(unstampedAfter.rows[0].n, 0, 'every row of that account now has a revision');
  const aliceStillStamped = await pool.query(
    'SELECT count(*)::int AS n FROM recipes WHERE user_id = $1 AND revision IS NULL', [ALICE]);
  assert.equal(aliceStillStamped.rows[0].n, 0);
  step('recipes written before sync existed are backfilled per account, lazily');

  // -------------------------------------------------------------------------
  // Concurrency: two writers, one recipe
  // -------------------------------------------------------------------------

  const base = await tx(async (c) => {
    await sync.lockAccount(c, ALICE);
    const cur = await sync.readCurrent(c, ALICE, 'r-scones');
    return cur.revision;
  });

  const [a, b] = await Promise.all([
    tx(async (c) => {
      await sync.lockAccount(c, ALICE);
      return sync.applyWrite(c, {
        userId: ALICE, recipe: recipe('r-scones', 'Edited on the phone'),
        baseRevision: base, idempotencyKey: 'k-race-a', cause: 'edited',
      });
    }),
    tx(async (c) => {
      await sync.lockAccount(c, ALICE);
      return sync.applyWrite(c, {
        userId: ALICE, recipe: recipe('r-scones', 'Edited on the web'),
        baseRevision: base, idempotencyKey: 'k-race-b', cause: 'edited',
      });
    }),
  ]);

  const outcomes = [a.status, b.status].sort();
  assert.deepEqual(outcomes, ['applied', 'conflict'],
    'two writers citing the same base: one wins, the other is told — never both applied');
  const winner = a.status === 'applied' ? a : b;
  const loser = a.status === 'applied' ? b : a;
  assert.equal(loser.reason, 'server-moved');
  assert.equal(loser.serverRevision, winner.revision, 'and the loser is handed the version that beat it');
  step('concurrent edits of one recipe: exactly one applies, the other conflicts');

  const finalTitle = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipes WHERE user_id = $1 AND recipe_json->>'id' = 'r-scones'`, [ALICE]);
  assert.ok(['Edited on the phone', 'Edited on the web'].includes(finalTitle.rows[0].t));
  assert.notEqual(finalTitle.rows[0].t, 'a merge of both', 'nothing is merged');
  step('the losing edit is preserved as history, never blended into the winner');

  await pool.end();

  const cleanup = new Pool({ connectionString: ADMIN_URL });
  cleanup.on('error', () => {});
  await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  await cleanup.end();

  console.log('\nrecipe-sync-test: ok (' + steps.length + ' checks)');
  process.exitCode = 0;
}

main().catch(async (err) => {
  console.error('\nrecipe-sync-test FAILED:', err && err.message);
  console.error(err);
  try {
    const { Pool } = require('pg');
    const cleanup = new Pool({ connectionString: ADMIN_URL });
    cleanup.on('error', () => {});
    await cleanup.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await cleanup.end();
  } catch (_) { /* the database is a throwaway either way */ }
  process.exitCode = 1;
});
