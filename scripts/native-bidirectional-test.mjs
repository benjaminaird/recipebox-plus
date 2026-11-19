// The real coordinator, the real server, a real PostgreSQL database.
//
// This is the gate the brief sets before automatic uploads may be switched on:
// conflict handling, queued retries, account isolation and recovery from an
// interrupted synchronisation, all demonstrated end to end rather than in
// units. The algorithm under test is apps/mobile/src/sync/coordinator.ts —
// the one the phone ships — talking to /api/v1/sync/recipes over HTTP.
//
// The device's SQLite is the one thing standing in: a memory store of the same
// shape plays the phone's database, because Expo's SQLite does not run under
// node. What that store does *not* stand in for is the rules, which all live
// in the coordinator and are therefore the real ones.
//
// Opt-in, destructive to its own database only. Never production.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

process.exitCode = 1;

const require = createRequire(import.meta.url);
const DB_URL = process.env.RECIPE_SYNC_TEST_DATABASE_URL
  || process.env.DEVICE_AUTH_TEST_DATABASE_URL
  || '';

if (!DB_URL) {
  console.log('native-bidirectional-test: skipped (set RECIPE_SYNC_TEST_DATABASE_URL to an isolated PostgreSQL instance)');
  process.exitCode = 0;
  process.exit(0);
}
if (!/test|localhost|127\.0\.0\.1/i.test(DB_URL) || /neon\.tech/i.test(DB_URL)) {
  console.error('database URL does not look isolated; refusing to touch it');
  process.exit(1);
}

const { runSync } = await import('../apps/mobile/src/sync/coordinator.ts');
const { enqueue } = await import('../apps/mobile/src/sync/outbox.ts');

const PASSWORD = 'correct horse battery';
const DB_NAME = 'rb_bidi_' + crypto.randomBytes(4).toString('hex');

const steps = [];
const step = (name) => { steps.push(name); console.log('  ' + String(steps.length).padStart(2) + '. ' + name); };

function urlForDatabase(base, name) {
  const u = new URL(base);
  u.pathname = '/' + name;
  return u.toString();
}

function recipe(id, title) {
  return {
    id, title,
    sections: [{
      name: '',
      ingredients: [{ id: 'i1', name: 'plain flour', amount: '250', unit: 'g' }],
      steps: [{ id: 's1', text: 'Mix.' }],
    }],
  };
}

let base = '';
async function http(method, path, { token, body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* the assertion will say */ }
  return { status: res.status, json, text };
}

/** The phone's database, as far as the coordinator can tell. */
function deviceStore(accountId) {
  const local = new Map();
  const recipes = new Map();
  let outbox = [];
  const conflicts = [];
  let watermark = 0;

  return {
    accountId: () => accountId,
    getWatermark: async () => watermark,
    setWatermark: async (r) => { watermark = r; },
    getLocal: async (id) => local.get(id) ?? null,
    putRemote: async ({ envelope, revision }) => {
      recipes.set(envelope.recipe.id, envelope.recipe);
      local.set(envelope.recipe.id, {
        recipeId: envelope.recipe.id, origin: 'cloud', adopted: true,
        serverRevision: revision, deletedLocally: false,
      });
    },
    applyRemoteDeletion: async (id, revision) => {
      const row = local.get(id);
      if (row) local.set(id, { ...row, deletedLocally: true, serverRevision: revision });
      recipes.delete(id);
    },
    clearCloudRecipes: async () => {
      // Everything the account sent goes, so a resync can put it back —
      // except anything this device still owes. A resync is a bookkeeping
      // problem; discarding an unsent edit would make it lost work.
      const owed = new Set(outbox.map((e) => e.recipeId));
      for (const [id, row] of [...local]) {
        if (row.origin === 'cloud' && !owed.has(id)) { local.delete(id); recipes.delete(id); }
      }
    },
    listOutbox: async () => outbox.slice(),
    removeFromOutbox: async (id) => { outbox = outbox.filter((e) => e.recipeId !== id); },
    updateOutboxEntry: async (e) => { outbox = outbox.map((x) => (x.recipeId === e.recipeId ? e : x)); },
    markSynced: async (id, revision, deleted) => {
      const row = local.get(id);
      if (row) local.set(id, { ...row, serverRevision: revision, deletedLocally: deleted });
    },
    recordConflict: async (c) => { conflicts.push(c); },

    // Test affordances, outside the interface the coordinator sees.
    _local: local,
    _recipes: recipes,
    _conflicts: conflicts,
    _outbox: () => outbox,
    _enqueue: (change) => { outbox = enqueue(outbox, { now: Date.now(), ...change }); },
    _write: (r, origin = 'local', adopted = false, serverRevision = null) => {
      recipes.set(r.id, r);
      local.set(r.id, { recipeId: r.id, origin, adopted, serverRevision, deletedLocally: false });
    },
    /** Everything survives a restart if it is only data. */
    _snapshot: () => JSON.parse(JSON.stringify({ outbox, watermark, local: [...local], recipes: [...recipes] })),
    _restore: (snap) => {
      outbox = snap.outbox;
      watermark = snap.watermark;
      local.clear(); for (const [k, v] of snap.local) local.set(k, v);
      recipes.clear(); for (const [k, v] of snap.recipes) recipes.set(k, v);
    },
  };
}

/** A transport against the real endpoints, with a switch for pulling the plug. */
function deviceTransport(token) {
  const state = { offline: false, failPush: false };
  return {
    state,
    pull: async (since, limit) => {
      if (state.offline) throw new Error('network unreachable');
      const res = await http('GET', `/api/v1/sync/recipes?since=${since}&limit=${limit}`, { token });
      if (res.status !== 200) { const e = new Error('pull failed: ' + res.text.slice(0, 120)); e.status = res.status; throw e; }
      return res.json;
    },
    push: async (body) => {
      if (state.offline || state.failPush) throw new Error('network unreachable');
      const res = await http('POST', '/api/v1/sync/recipes', { token, body });
      if (res.status !== 200) { const e = new Error('push failed: ' + res.text.slice(0, 120)); e.status = res.status; throw e; }
      return res.json;
    },
  };
}

const key = () => crypto.randomBytes(8).toString('hex');

async function main() {
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: DB_URL });
  admin.on('error', () => {});
  await admin.query('CREATE DATABASE ' + DB_NAME);

  process.env.DATABASE_URL = urlForDatabase(DB_URL, DB_NAME);
  // Bidirectional writes are enabled here and only here: an isolated database,
  // in a process this test owns. That is the whole point of the switch.
  process.env.RECIPEBOX_SYNC_WRITES = 'on';

  const app = require('../server');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.on('error', () => {});
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;

  try {
    await run(pool);
    console.log('\nnative-bidirectional-test: ok (' + steps.length + ' checks)');
    process.exitCode = 0;
  } finally {
    server.close();
    await pool.end().catch(() => {});
    await app._test.closePool().catch(() => {});
    await admin.query('DROP DATABASE IF EXISTS ' + DB_NAME).catch(() => {});
    await admin.end().catch(() => {});
  }
}

async function signIn(email, install) {
  const created = await http('POST', '/api/v1/auth/signup', {
    body: { email, password: PASSWORD, displayName: email.split('@')[0] },
  });
  assert.ok(created.status === 201 || created.status === 200, 'signup: ' + created.text.slice(0, 120));
  return created.json.user.id;
}

async function token(email, install) {
  const res = await http('POST', '/api/v1/auth/signin', {
    body: { email, password: PASSWORD, device: { name: install, platform: 'ios', installId: install } },
  });
  assert.strictEqual(res.status, 200, 'signin: ' + res.text.slice(0, 160));
  return res.json.accessToken;
}

async function run(pool) {
  const aliceEmail = 'alice-' + crypto.randomBytes(3).toString('hex') + '@recipebox.invalid';
  const bobEmail = 'bob-' + crypto.randomBytes(3).toString('hex') + '@recipebox.invalid';
  const aliceId = await signIn(aliceEmail);
  const bobId = await signIn(bobEmail);
  await pool.query('UPDATE profiles SET email_verified = true WHERE email IN ($1,$2)', [aliceEmail, bobEmail]);

  const aliceToken = await token(aliceEmail, 'phone-a');
  const secondToken = await token(aliceEmail, 'phone-b');
  const bobToken = await token(bobEmail, 'phone-bob');
  step('two accounts, and two of Alice’s devices, signed in');

  // ── 1. A local recipe uploads only once adopted ──────────────────────────
  const phoneA = deviceStore(aliceId);
  const transportA = deviceTransport(aliceToken);

  phoneA._write(recipe('lemon-posset', 'Lemon Posset'), 'sample');
  phoneA._write(recipe('mine', 'My own recipe'), 'local', false);
  phoneA._enqueue({ recipeId: 'lemon-posset', kind: 'write', recipe: recipe('lemon-posset', 'Lemon Posset'), baseRevision: null, idempotencyKey: key() });
  phoneA._enqueue({ recipeId: 'mine', kind: 'write', recipe: recipe('mine', 'My own recipe'), baseRevision: null, idempotencyKey: key() });

  let report = await runSync(phoneA, transportA, { uploads: true });
  assert.strictEqual(report.pushed, 0, 'neither was eligible');
  assert.strictEqual(report.rejected, 2);
  const serverCount = await pool.query('SELECT count(*)::int AS n FROM recipes WHERE user_id=$1', [aliceId]);
  assert.strictEqual(serverCount.rows[0].n, 0, 'and nothing reached the account');
  step('a sample and an un-adopted local recipe are refused, and reach no account');

  // Adopt the local one and try again.
  phoneA._write(recipe('mine', 'My own recipe'), 'local', true);
  phoneA._enqueue({ recipeId: 'mine', kind: 'write', recipe: recipe('mine', 'My own recipe'), baseRevision: null, idempotencyKey: key() });
  report = await runSync(phoneA, transportA, { uploads: true });
  assert.strictEqual(report.pushed, 1);
  const adopted = await pool.query(
    `SELECT revision FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='mine'`, [aliceId]);
  assert.strictEqual(adopted.rows.length, 1, 'the adopted recipe is in the account');
  step('once adopted, the recipe uploads and the sample still does not');

  // ── 2. The second device pulls it ────────────────────────────────────────
  const phoneB = deviceStore(aliceId);
  const transportB = deviceTransport(secondToken);
  report = await runSync(phoneB, transportB, { uploads: true });
  assert.strictEqual(report.pulled, 1);
  assert.strictEqual(phoneB._recipes.get('mine').title, 'My own recipe');
  step('a second device of the same account pulls it down');

  // ── 3. A conflict: both devices edit, one wins, both versions survive ────
  const baseRevision = phoneB._local.get('mine').serverRevision;
  phoneB._write({ ...recipe('mine', 'Edited on phone B'), id: 'mine' }, 'cloud', true, baseRevision);
  phoneB._enqueue({ recipeId: 'mine', kind: 'write', recipe: recipe('mine', 'Edited on phone B'), baseRevision, idempotencyKey: key() });
  report = await runSync(phoneB, transportB, { uploads: true });
  assert.strictEqual(report.pushed, 1, 'phone B gets there first');

  phoneA._enqueue({ recipeId: 'mine', kind: 'write', recipe: recipe('mine', 'Edited on phone A'), baseRevision, idempotencyKey: key() });
  // Deliberately no pull first: this is the race the revision check exists for.
  report = await runSync(phoneA, { ...transportA, pull: async () => ({ recipes: [], deletions: [], revision: baseRevision, more: false, resyncRequired: false }) }, { uploads: true });
  assert.strictEqual(report.conflicts, 1, 'phone A is told, not overwritten');
  assert.strictEqual(report.pushed, 0);
  assert.strictEqual(phoneA._conflicts.length, 1);
  assert.strictEqual(phoneA._conflicts[0].mine.title, 'Edited on phone A', 'what phone A wanted is kept');
  assert.strictEqual(phoneA._conflicts[0].theirs.title, 'Edited on phone B', 'and so is what won');
  const serverTitle = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='mine'`, [aliceId]);
  assert.strictEqual(serverTitle.rows[0].t, 'Edited on phone B', 'the account was not overwritten');
  step('concurrent edits: one applies, the other is kept whole as a conflict');

  // Both versions are in the server's history too.
  const history = await http('GET', '/api/v1/recipes/mine/versions', { token: aliceToken });
  assert.ok(history.json.versions.length >= 2, 'the server kept its own history of the winner');
  step('the server’s version history holds every applied change');

  // A recipe the pull declines to apply must not be lost.
  //
  // The pull skips a recipe this device still owes a change for -- correctly,
  // because the push decides whether it conflicts. What must not happen is
  // that the watermark advances past it anyway: the next pull would ask for
  // changes AFTER a revision it never applied, the server would never mention
  // that recipe again, and the two sides would stay diverged for ever with no
  // way back. Found by running the app on a simulator, where a recipe held
  // back during a conflict kept its old title after the conflict was settled.
  //
  // On a recipe of its own, so the scenario disturbs nothing else here.
  phoneB._write(recipe('held', 'As phone B wrote it'), 'local', true);
  phoneB._enqueue({ recipeId: 'held', kind: 'write', recipe: recipe('held', 'As phone B wrote it'), baseRevision: null, idempotencyKey: key() });
  report = await runSync(phoneB, transportB, { uploads: true });
  assert.strictEqual(report.pushed, 1);

  const phoneHeld = deviceStore(aliceId);
  const transportHeld = deviceTransport(await token(aliceEmail, 'phone-held'));
  await runSync(phoneHeld, transportHeld, { uploads: true });
  assert.strictEqual(phoneHeld._recipes.get('held').title, 'As phone B wrote it');
  const heldBase = phoneHeld._local.get('held').serverRevision;

  // Phone B moves it on.
  phoneB._write(recipe('held', 'Moved on by phone B'), 'cloud', true, heldBase);
  phoneB._enqueue({ recipeId: 'held', kind: 'write', recipe: recipe('held', 'Moved on by phone B'), baseRevision: heldBase, idempotencyKey: key() });
  report = await runSync(phoneB, transportB, { uploads: true });
  assert.strictEqual(report.pushed, 1);

  // And this device has an unsent change of its own for the same recipe, so
  // the pull holds it back. Pull-only, so the push does not settle it.
  phoneHeld._enqueue({ recipeId: 'held', kind: 'write', recipe: recipe('held', 'Held back here'), baseRevision: heldBase, idempotencyKey: key() });
  report = await runSync(phoneHeld, transportHeld);
  assert.strictEqual(report.pulled, 0, 'not overwritten while this device owes a change');
  assert.strictEqual(
    phoneHeld._recipes.get('held').title, 'As phone B wrote it', 'its own copy is untouched');
  assert.ok(
    (await phoneHeld.getWatermark()) < heldBase + 1,
    'and the watermark did not step over what it declined to apply');

  // The change is settled, and the server's version arrives after all.
  for (const e of [...phoneHeld._outbox()]) await phoneHeld.removeFromOutbox(e.recipeId);
  report = await runSync(phoneHeld, transportHeld, { uploads: true });
  assert.strictEqual(
    phoneHeld._recipes.get('held').title, 'Moved on by phone B',
    'once nothing is owed, the account’s version is delivered rather than skipped for ever');
  step('a recipe held back during a pull is not lost once the queue clears');

  // ── 4. Queued retries across failure and restart ─────────────────────────
  const phoneC = deviceStore(aliceId);
  const transportC = deviceTransport(await token(aliceEmail, 'phone-c'));
  await runSync(phoneC, transportC, { uploads: true });

  phoneC._write(recipe('queued', 'Written while offline'), 'local', true);
  const stableKey = key();
  phoneC._enqueue({ recipeId: 'queued', kind: 'write', recipe: recipe('queued', 'Written while offline'), baseRevision: null, idempotencyKey: stableKey });

  // Fully offline: the pull fails first, so the push is never attempted. The
  // change is still owed, and deliberately not counted as a failed send —
  // backing off a change we never tried would delay it for no reason.
  transportC.state.offline = true;
  report = await runSync(phoneC, transportC, { uploads: true });
  assert.strictEqual(report.stoppedBy, 'network');
  assert.strictEqual(report.stillQueued, 1, 'the change is still owed');
  assert.strictEqual(phoneC._outbox()[0].attempts, 0, 'a pull that failed is not a push that failed');

  // Now a push that genuinely fails: the pull succeeds, the send does not.
  transportC.state.offline = false;
  transportC.state.failPush = true;
  report = await runSync(phoneC, transportC, { uploads: true });
  assert.strictEqual(report.stoppedBy, 'network');
  assert.strictEqual(report.stillQueued, 1);
  assert.strictEqual(phoneC._outbox()[0].attempts, 1, 'that one is counted');
  assert.ok(phoneC._outbox()[0].nextAttemptAt > 0, 'and backed off before the next try');
  assert.strictEqual(phoneC._outbox()[0].recipe.title, 'Written while offline', 'with the edit intact');
  transportC.state.failPush = false;

  // The app is killed and restarted: everything is just data.
  const snapshot = phoneC._snapshot();
  const revived = deviceStore(aliceId);
  revived._restore(snapshot);
  assert.strictEqual(revived._outbox().length, 1, 'the queue survived termination');
  assert.strictEqual(revived._outbox()[0].idempotencyKey, stableKey, 'with its idempotency key');

  // Make the entry due again, then come back online.
  revived._outbox()[0].nextAttemptAt = 0;
  const transportD = deviceTransport(await token(aliceEmail, 'phone-c2'));
  report = await runSync(revived, transportD, { uploads: true });
  assert.strictEqual(report.pushed, 1, 'and uploads once the network returns');
  const queuedRow = await pool.query(
    `SELECT count(*)::int AS n FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='queued'`, [aliceId]);
  assert.strictEqual(queuedRow.rows[0].n, 1);
  step('an offline edit survives failure, termination and restart, then uploads');

  // Replaying the same key does not write a second copy.
  revived._enqueue({ recipeId: 'queued', kind: 'write', recipe: recipe('queued', 'Written while offline'), baseRevision: null, idempotencyKey: stableKey });
  report = await runSync(revived, transportD, { uploads: true });
  const afterReplay = await pool.query(
    `SELECT count(*)::int AS n FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='queued'`, [aliceId]);
  assert.strictEqual(afterReplay.rows[0].n, 1, 'a replayed push is applied once');
  step('a replayed push with the same key does not duplicate the recipe');

  // ── 5. Deletion and restoration round trip ───────────────────────────────
  // The other device has to be holding the recipe before a deletion can mean
  // anything to it: a delete for something you never had is correctly ignored.
  await runSync(phoneB, transportB, { uploads: true });
  assert.ok(phoneB._recipes.has('queued'), 'the second device holds it before it is deleted');

  const delRev = (await pool.query(
    `SELECT revision FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='queued'`, [aliceId])).rows[0].revision;
  revived._enqueue({ recipeId: 'queued', kind: 'delete', recipe: null, baseRevision: Number(delRev), idempotencyKey: key() });
  report = await runSync(revived, transportD, { uploads: true });
  assert.strictEqual(report.pushed, 1);
  const tomb = await pool.query(
    `SELECT deleted_at FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='queued'`, [aliceId]);
  assert.ok(tomb.rows[0].deleted_at, 'the server keeps a tombstone, not a hole');

  // The other device hears about it.
  report = await runSync(phoneB, transportB, { uploads: true });
  assert.ok(report.deletionsApplied >= 1, 'the second device applies the deletion');
  step('a delete made on one device reaches the other as a deletion');

  const trash = await http('GET', '/api/v1/trash', { token: aliceToken });
  assert.ok(trash.json.recipes.some((r) => r.recipe.id === 'queued'), 'and sits in the 30-day Trash');
  const restored = await http('POST', '/api/v1/trash/queued/restore', { token: aliceToken });
  assert.strictEqual(restored.json.status, 'applied');
  report = await runSync(phoneB, transportB, { uploads: true });
  assert.ok(phoneB._recipes.has('queued'), 'and a restore comes back down');
  step('restoring from the Trash propagates back to the devices');

  // ── 6. Account isolation, under a full bidirectional run ─────────────────
  const bobPhone = deviceStore(bobId);
  const bobTransport = deviceTransport(bobToken);
  bobPhone._write(recipe('mine', "Bob's own recipe with the same id"), 'local', true);
  bobPhone._enqueue({ recipeId: 'mine', kind: 'write', recipe: recipe('mine', "Bob's own recipe with the same id"), baseRevision: null, idempotencyKey: key() });
  report = await runSync(bobPhone, bobTransport, { uploads: true });
  assert.strictEqual(report.pushed, 1, 'the same id in another account is a different recipe');

  const aliceStill = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='mine'`, [aliceId]);
  assert.strictEqual(aliceStill.rows[0].t, 'Edited on phone B', "Alice's copy is untouched");
  assert.ok(!bobPhone._recipes.has('Edited on phone B'), 'and Bob never saw hers');
  const bobPulled = [...bobPhone._recipes.values()].map((r) => r.title);
  assert.ok(!bobPulled.includes('Edited on phone B'), "Bob's library holds none of Alice's recipes");
  step('account isolation holds through a full bidirectional run');

  // ── 7. Recovery from a horizon the server can no longer serve ────────────
  await pool.query(
    `UPDATE account_revisions SET tombstones_purged_before = $2 WHERE user_id = $1`,
    [aliceId, 10_000]
  );
  const stranded = deviceStore(aliceId);
  stranded._write(recipe('kept-local', 'Written here, never uploaded'), 'local', false);
  await stranded.setWatermark(5);
  // And a cloud recipe this device has edited but not sent. It is the case
  // that costs real work: the recipe came FROM the account, so a rebuild would
  // throw it away, and the edit on it has never been anywhere else.
  //
  // It has to be a recipe the account really holds, cited against the revision
  // the account really has — an invented id, or a stale base, would be
  // refused for reasons that have nothing to do with the resync and would
  // prove nothing about it.
  const minesRevision = await pool.query(
    `SELECT revision FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='mine'`, [aliceId]);
  stranded._write(recipe('mine', 'Edited on the stranded phone'), 'cloud', true, minesRevision.rows[0].revision);
  stranded._enqueue({
    recipeId: 'mine', kind: 'write',
    recipe: recipe('mine', 'Edited on the stranded phone'),
    baseRevision: Number(minesRevision.rows[0].revision), idempotencyKey: key(),
  });

  report = await runSync(stranded, deviceTransport(await token(aliceEmail, 'phone-stale')), { uploads: true });
  assert.strictEqual(report.resynced, true, 'a device too far behind is rebuilt rather than lied to');
  assert.ok(stranded._recipes.has('kept-local'), 'and its own work is not collateral damage');
  assert.strictEqual(stranded._recipes.get('kept-local').title, 'Written here, never uploaded');
  assert.ok(stranded._recipes.has('mine'), 'nor is an unsent edit to a cloud recipe');
  assert.strictEqual(
    stranded._recipes.get('mine').title, 'Edited on the stranded phone',
    "the rebuild did not replace it with the account's copy behind the cook's back");
  const strandedPending = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='mine'`,
    [aliceId]);
  assert.strictEqual(
    strandedPending.rows[0].t, 'Edited on the stranded phone',
    'and it reached the account rather than being dropped as unsendable');
  step('a device past the tombstone horizon resyncs without losing local work');

  // ── 8. Uploads stay off unless asked ─────────────────────────────────────
  const cautious = deviceStore(aliceId);
  cautious._write(recipe('never', 'Should not be sent'), 'local', true);
  cautious._enqueue({ recipeId: 'never', kind: 'write', recipe: recipe('never', 'Should not be sent'), baseRevision: null, idempotencyKey: key() });
  report = await runSync(cautious, deviceTransport(await token(aliceEmail, 'phone-cautious')));
  assert.strictEqual(report.pushed, 0);
  const neverRow = await pool.query(
    `SELECT count(*)::int AS n FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='never'`, [aliceId]);
  assert.strictEqual(neverRow.rows[0].n, 0, 'the default run uploads nothing at all');
  assert.strictEqual(report.stillQueued, 1, 'and leaves the queue intact for when it is allowed');
  step('the default run is pull-only, and the queue waits');
}

main().catch(async (err) => {
  console.error('\nnative-bidirectional-test FAILED:', err && err.message);
  console.error(err);
  process.exitCode = 1;
});
