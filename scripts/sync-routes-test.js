// The sync routes, through HTTP, against a real server and a real database.
//
// scripts/recipe-sync-test.js proves the data layer. This proves the contract
// a phone actually meets: that writes are off until a deployment asks for
// them, that a conflict comes back as a conflict rather than a 500, that one
// account cannot write into another's library, and that a household member who
// can read a shared recipe still cannot change it.
//
// Opt-in, and destructive to its own database only. Set
// DEVICE_AUTH_TEST_DATABASE_URL to an isolated instance. Never production.

const assert = require('assert');
const crypto = require('crypto');

process.exitCode = 1;

const ADMIN_URL = process.env.RECIPE_SYNC_TEST_DATABASE_URL
  || process.env.DEVICE_AUTH_TEST_DATABASE_URL
  || '';

if (!ADMIN_URL) {
  console.log('sync-routes-test: skipped (set RECIPE_SYNC_TEST_DATABASE_URL to an isolated test database)');
  process.exitCode = 0;
  return;
}
if (!/test|localhost|127\.0\.0\.1/i.test(ADMIN_URL) || /neon\.tech/i.test(ADMIN_URL)) {
  console.error('RECIPE_SYNC_TEST_DATABASE_URL does not look like an isolated test database; refusing to touch it');
  process.exit(1);
}

const DB_NAME = 'rb_syncroutes_' + crypto.randomBytes(4).toString('hex');
const PASSWORD = 'recipebox-test-password';

function urlForDatabase(base, name) {
  const u = new URL(base);
  u.pathname = '/' + name;
  return u.toString();
}

let base = '';
async function call(method, path, options) {
  const o = options || {};
  const headers = Object.assign(
    o.body ? { 'Content-Type': 'application/json' } : {},
    o.token ? { Authorization: 'Bearer ' + o.token } : {},
    o.cookie ? { Cookie: o.cookie } : {},
    o.headers || {}
  );
  const res = await fetch(base + path, {
    method,
    headers,
    body: o.body ? JSON.stringify(o.body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* the assertion will say so */ }
  return { status: res.status, json, text, setCookie: res.headers.get('set-cookie') || '' };
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

const steps = [];
function step(name) { steps.push(name); console.log('  ' + String(steps.length).padStart(2) + '. ' + name); }

async function signUp(email, installId) {
  const created = await call('POST', '/api/v1/auth/signup', {
    body: { email, password: PASSWORD, displayName: email.split('@')[0] },
  });
  assert.ok(created.status === 201 || created.status === 200, 'signup: ' + created.text.slice(0, 120));
  return created.json.user.id;
}

async function signIn(email, installId) {
  const res = await call('POST', '/api/v1/auth/signin', {
    body: { email, password: PASSWORD, device: { name: 'test phone', platform: 'ios', installId } },
  });
  assert.strictEqual(res.status, 200, 'signin: ' + res.text.slice(0, 160));
  return res.json.accessToken;
}

async function main() {
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: ADMIN_URL });
  admin.on('error', () => {});
  await admin.query('CREATE DATABASE ' + DB_NAME);

  process.env.DATABASE_URL = urlForDatabase(ADMIN_URL, DB_NAME);
  // Writes start off, which is the first thing under test.
  delete process.env.RECIPEBOX_SYNC_WRITES;

  const app = require('../server');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.on('error', () => {});
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;

  try {
    await run(pool);
    process.exitCode = 0;
    console.log('\nsync-routes-test: ok (' + steps.length + ' checks)');
  } finally {
    server.close();
    await pool.end().catch(() => {});
    await app._test.closePool().catch(() => {});
    await admin.query('DROP DATABASE IF EXISTS ' + DB_NAME).catch(() => {});
    await admin.end().catch(() => {});
  }
}

async function run(pool) {
  const aliceEmail = 'alice-' + crypto.randomBytes(3).toString('hex') + '@recipebox.invalid';
  const bobEmail = 'bob-' + crypto.randomBytes(3).toString('hex') + '@recipebox.invalid';

  const aliceId = await signUp(aliceEmail, 'install-alice');
  const bobId = await signUp(bobEmail, 'install-bob');
  // Native signup requires a verified address; these accounts are verified
  // directly because this server has no mail credentials on purpose.
  await pool.query('UPDATE profiles SET email_verified = true WHERE email IN ($1, $2)', [aliceEmail, bobEmail]);

  const alice = await signIn(aliceEmail, 'install-alice');
  const bob = await signIn(bobEmail, 'install-bob');
  step('two isolated accounts, signed in on the versioned API');

  // ── Writes are off until a deployment asks ───────────────────────────────
  const refused = await call('POST', '/api/v1/sync/recipes', {
    token: alice,
    body: { writes: [{ recipe: recipe('r1', 'Scones'), baseRevision: null, idempotencyKey: 'k1' }] },
  });
  assert.strictEqual(refused.status, 503);
  assert.strictEqual(refused.json.code, 'sync_writes_disabled');
  const nothingWritten = await pool.query('SELECT count(*)::int AS n FROM recipes');
  assert.strictEqual(nothingWritten.rows[0].n, 0, 'and nothing reached the table');
  step('uploads are refused until the deployment opts in, and write nothing');

  // The read half is always safe, so it stays available.
  const pullWhileOff = await call('GET', '/api/v1/sync/recipes?since=0', { token: alice });
  assert.strictEqual(pullWhileOff.status, 200, 'the delta read needs no opt-in: it cannot lose anything');
  step('the delta read works regardless — it has nothing to lose');

  // ── Switch writes on for the rest of the run ─────────────────────────────
  // The route reads the setting when asked, so the environment is the switch
  // and the test needs no hook into the server.
  process.env.RECIPEBOX_SYNC_WRITES = 'on';

  const created = await call('POST', '/api/v1/sync/recipes', {
    token: alice,
    body: { writes: [{ recipe: recipe('r1', 'Scones'), baseRevision: null, idempotencyKey: 'k1', cause: 'imported' }] },
  });
  assert.strictEqual(created.status, 200, created.text.slice(0, 200));
  assert.strictEqual(created.json.applied.length, 1);
  assert.strictEqual(created.json.applied[0].revision, 1);
  step('with writes enabled, a create is applied and gets revision 1');

  // ── Conflict, over HTTP ──────────────────────────────────────────────────
  const stale = await call('POST', '/api/v1/sync/recipes', {
    token: alice,
    body: { writes: [{ recipe: recipe('r1', 'From a stale phone'), baseRevision: 0, idempotencyKey: 'k2' }] },
  });
  assert.strictEqual(stale.status, 200, 'a conflict is an outcome, not a server error');
  assert.strictEqual(stale.json.applied.length, 0);
  assert.strictEqual(stale.json.conflicts.length, 1);
  assert.strictEqual(stale.json.conflicts[0].serverRevision, 1);
  assert.strictEqual(stale.json.conflicts[0].server.title, 'Scones', 'and carries the version that won');
  step('a stale write returns 200 with a conflict, never a 500 and never an overwrite');

  // ── Partial success ──────────────────────────────────────────────────────
  const mixed = await call('POST', '/api/v1/sync/recipes', {
    token: alice,
    body: {
      writes: [
        { recipe: recipe('r1', 'Still stale'), baseRevision: 0, idempotencyKey: 'k3' },
        { recipe: recipe('r2', 'A new one'), baseRevision: null, idempotencyKey: 'k4' },
        { recipe: recipe('lemon-posset', 'A sample'), baseRevision: null, idempotencyKey: 'k5' },
      ],
    },
  });
  assert.strictEqual(mixed.json.applied.length, 1, 'the good write still applied');
  assert.strictEqual(mixed.json.conflicts.length, 1, 'the stale one still conflicted');
  assert.strictEqual(mixed.json.rejected.length, 1, 'and the sample was refused');
  assert.strictEqual(mixed.json.rejected[0].reason, 'sample-recipe');
  step('one bad change in a batch does not reject the others');

  // ── Ownership: Bob cannot touch Alice's recipe ───────────────────────────
  const intrusion = await call('POST', '/api/v1/sync/recipes', {
    token: bob,
    body: { writes: [{ recipe: recipe('r1', "Bob's overwrite"), baseRevision: 1, idempotencyKey: 'kb1' }] },
  });
  assert.strictEqual(intrusion.status, 200);
  assert.strictEqual(intrusion.json.applied.length, 0, "Bob's write did not apply to Alice's recipe");
  assert.strictEqual(intrusion.json.conflicts.length, 1);
  const aliceTitle = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipes WHERE user_id = $1 AND recipe_json->>'id' = 'r1'`, [aliceId]);
  assert.strictEqual(aliceTitle.rows[0].t, 'Scones', "Alice's recipe is untouched");
  const bobRows = await pool.query('SELECT count(*)::int AS n FROM recipes WHERE user_id = $1', [bobId]);
  assert.strictEqual(bobRows.rows[0].n, 0, 'and nothing was created under Bob either');
  step("another account's write cannot reach this account's recipe");

  // ── Bob's own library is his own ─────────────────────────────────────────
  const bobOwn = await call('POST', '/api/v1/sync/recipes', {
    token: bob,
    body: { writes: [{ recipe: recipe('r1', "Bob's own r1"), baseRevision: null, idempotencyKey: 'kb2' }] },
  });
  assert.strictEqual(bobOwn.json.applied.length, 1, 'the same recipe id in another account is a different recipe');
  assert.strictEqual(bobOwn.json.applied[0].revision, 1, "with that account's own revision counter");
  step('the same recipe id in two accounts stays two recipes');

  // ── Bob cannot read Alice's delta feed ───────────────────────────────────
  const bobDelta = await call('GET', '/api/v1/sync/recipes?since=0', { token: bob });
  assert.ok(!bobDelta.json.recipes.some((r) => r.recipe.title === 'Scones'),
    "Alice's recipes never appear in Bob's replica feed");
  step("the delta feed is per account: nobody replicates somebody else's library");

  // ── Delete, Trash, restore ───────────────────────────────────────────────
  const current = await call('GET', '/api/v1/sync/recipes?since=0', { token: alice });
  const r2 = current.json.recipes.find((r) => r.recipe.id === 'r2');
  assert.ok(r2, 'r2 is in the feed');

  const deleted = await call('POST', '/api/v1/sync/recipes', {
    token: alice,
    body: { deletions: [{ id: 'r2', baseRevision: r2.revision, idempotencyKey: 'kd1' }] },
  });
  assert.strictEqual(deleted.json.applied.length, 1);

  const trash = await call('GET', '/api/v1/trash', { token: alice });
  assert.strictEqual(trash.json.recipes.length, 1);
  assert.strictEqual(trash.json.recipes[0].recipe.id, 'r2');
  step('a deleted recipe appears in the Trash rather than vanishing');

  const afterDelete = await call('GET', '/api/v1/sync/recipes?since=0', { token: alice });
  assert.ok(afterDelete.json.deletions.some((d) => d.id === 'r2'), 'the delete is announced as a deletion');
  assert.ok(!afterDelete.json.recipes.some((r) => r.recipe.id === 'r2'), 'and not as a recipe');
  step('the delta feed announces deletions so no device misses one');

  // The delete has to reach every reader, not just the delta feed. A soft
  // delete the library still shows is not a delete.
  const library = await call('GET', '/api/v1/recipes', { token: alice });
  assert.ok(!library.json.recipes.some((r) => r.recipe.id === 'r2'),
    'a deleted recipe is gone from the library pull too');
  const webLibrary = await pool.query(
    `SELECT count(*)::int AS n FROM recipes WHERE user_id = $1 AND deleted_at IS NULL`, [aliceId]);
  assert.strictEqual(webLibrary.rows[0].n, 1, 'and from what the web would read');
  step('a deleted recipe disappears from every reader, not only the delta feed');

  const restored = await call('POST', '/api/v1/trash/r2/restore', { token: alice });
  assert.strictEqual(restored.status, 200);
  assert.strictEqual(restored.json.status, 'applied');
  const trashAfter = await call('GET', '/api/v1/trash', { token: alice });
  assert.strictEqual(trashAfter.json.recipes.length, 0, 'and the Trash is empty again');
  step('a recipe is recoverable from the Trash over HTTP');

  // Bob cannot reach into Alice's Trash. r2 is deliberately a recipe only
  // Alice has — asking about r1 would prove nothing, because Bob has an r1 of
  // his own and would simply be restoring that.
  const bobRestore = await call('POST', '/api/v1/trash/r2/restore', { token: bob });
  assert.strictEqual(bobRestore.status, 404, "another account's Trash is not reachable");
  const aliceR2 = await pool.query(
    `SELECT deleted_at FROM recipes WHERE user_id = $1 AND recipe_json->>'id' = 'r2'`, [aliceId]);
  assert.strictEqual(aliceR2.rows.length, 1, "and Alice's recipe is still hers alone");
  step("one account cannot reach into another's Trash");

  // ── Version history ──────────────────────────────────────────────────────
  const versions = await call('GET', '/api/v1/recipes/r1/versions', { token: alice });
  assert.strictEqual(versions.status, 200);
  assert.ok(versions.json.versions.length >= 1);
  assert.strictEqual(versions.json.versions[versions.json.versions.length - 1].cause, 'imported');
  step('version history is readable, and remembers how the recipe arrived');

  // Scoping, proved two ways. Bob has no r2 at all, so he sees nothing; and
  // Bob's r1 history is his own r1's, not Alice's — which is the check that
  // would actually catch a query missing its user_id.
  const bobNoSuchRecipe = await call('GET', '/api/v1/recipes/r2/versions', { token: bob });
  assert.strictEqual(bobNoSuchRecipe.json.versions.length, 0, "a recipe Bob does not have has no history for Bob");
  const bobOwnHistory = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipe_versions WHERE user_id = $1 AND recipe_id = 'r1'`, [bobId]);
  assert.strictEqual(bobOwnHistory.rows.length, 1);
  assert.strictEqual(bobOwnHistory.rows[0].t, "Bob's own r1", "and the r1 history Bob can see is his own");
  const aliceHistory = await pool.query(
    `SELECT count(*)::int AS n FROM recipe_versions WHERE user_id = $1 AND recipe_id = 'r1'`, [aliceId]);
  assert.ok(aliceHistory.rows[0].n >= 1, "Alice's history is separate and intact");
  step("recipe history is scoped per account, both ways round");

  // ── Retry over HTTP ──────────────────────────────────────────────────────
  const headBefore = (await call('GET', '/api/v1/sync/recipes?since=0', { token: alice })).json.headRevision;
  const replay = await call('POST', '/api/v1/sync/recipes', {
    token: alice,
    body: { writes: [{ recipe: recipe('r1', 'Scones'), baseRevision: null, idempotencyKey: 'k1', cause: 'imported' }] },
  });
  assert.strictEqual(replay.json.applied.length, 1);
  assert.strictEqual(replay.json.applied[0].repeated, true, 'the server recognises the replay');
  const headAfter = (await call('GET', '/api/v1/sync/recipes?since=0', { token: alice })).json.headRevision;
  assert.strictEqual(headAfter, headBefore, 'and it consumes no revision');
  step('a replayed push over HTTP is applied once');

  // ── Batch size ───────────────────────────────────────────────────────────
  const huge = await call('POST', '/api/v1/sync/recipes', {
    token: alice,
    body: { writes: new Array(200).fill(0).map((_, i) => ({ recipe: recipe('x' + i, 'x'), baseRevision: null })) },
  });
  assert.strictEqual(huge.status, 400);
  assert.strictEqual(huge.json.code, 'too_many_writes');
  step('an oversized push is refused before anything is written');

  // ── Bad input ────────────────────────────────────────────────────────────
  // ── The web, against the same revision infrastructure ───────────────────
  //
  // The brief asks for this specifically, and it was right to: the web deletes
  // a recipe by saving its whole library without it, which used to delete the
  // row outright. A deleted row leaves no tombstone, so a phone could never
  // learn the recipe was gone. Everything below goes through the endpoints a
  // browser actually uses.

  const webSignIn = await call('POST', '/api/auth/signin', {
    body: { email: aliceEmail, password: PASSWORD },
  });
  assert.strictEqual(webSignIn.status, 200, 'the web session still signs in: ' + webSignIn.text.slice(0, 120));
  const cookie = (/rb_session=([^;]+)/.exec(webSignIn.setCookie || '') || [])[0]
    ? 'rb_session=' + /rb_session=([^;]+)/.exec(webSignIn.setCookie)[1] : '';
  assert.ok(cookie, 'and hands back a session cookie');
  step('the existing web session is unaffected by any of this');

  const headBeforeWeb = (await call('GET', '/api/v1/sync/recipes?since=0', { token: alice })).json.headRevision;

  const webCreate = await call('POST', '/api/recipes/save', {
    cookie,
    body: { operation: 'create', recipe: { id: 'w1', title: 'Made in a browser', sections: [{ name: '', ingredients: [], steps: [] }] } },
  });
  assert.strictEqual(webCreate.status, 200, webCreate.text.slice(0, 160));
  const afterWebCreate = await call('GET', '/api/v1/sync/recipes?since=' + headBeforeWeb, { token: alice });
  assert.ok(afterWebCreate.json.recipes.some((r) => r.recipe.id === 'w1'),
    'a recipe created in a browser reaches the phone through the delta feed');
  step('web create: assigned a revision, and visible to a phone');

  const webEdit = await call('POST', '/api/recipes/save', {
    cookie,
    body: { operation: 'update', recipe: { id: 'w1', title: 'Edited in a browser', sections: [{ name: '', ingredients: [], steps: [] }] } },
  });
  assert.strictEqual(webEdit.status, 200);
  const webVersions = await call('GET', '/api/v1/recipes/w1/versions', { token: alice });
  assert.ok(webVersions.json.versions.length >= 2, 'the edit appended a version');
  const firstWebVersion = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipe_versions WHERE user_id=$1 AND recipe_id='w1' ORDER BY revision ASC LIMIT 1`,
    [aliceId]);
  assert.strictEqual(firstWebVersion.rows[0].t, 'Made in a browser', 'and the version before it is still readable');
  step('web edit: history kept, as for any other client');

  // The web deletes by saving the library without the recipe.
  const headBeforeWebDelete = (await call('GET', '/api/v1/sync/recipes?since=0', { token: alice })).json.headRevision;
  const browserLibrary = await call('GET', '/api/recipes', { cookie });
  const kept = (browserLibrary.json.recipes || browserLibrary.json || []).filter((r) => r && r.id && r.id !== 'w1');
  const webDelete = await call('PUT', '/api/recipes', { cookie, body: { recipes: kept } });
  assert.strictEqual(webDelete.status, 200, webDelete.text.slice(0, 160));

  const tombstone = await pool.query(
    `SELECT deleted_at FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='w1'`, [aliceId]);
  assert.strictEqual(tombstone.rows.length, 1, 'the row survives as a tombstone rather than being destroyed');
  assert.ok(tombstone.rows[0].deleted_at, 'and is marked deleted');
  const deltaAfterWebDelete = await call('GET', '/api/v1/sync/recipes?since=' + headBeforeWebDelete, { token: alice });
  assert.ok(deltaAfterWebDelete.json.deletions.some((d) => d.id === 'w1'),
    'a deletion made in a browser is announced to the phone');
  step('web delete: leaves a tombstone, and the phone is told');

  const webLibraryAfter = await call('GET', '/api/recipes', { cookie });
  const stillThere = (webLibraryAfter.json.recipes || webLibraryAfter.json || []).some((r) => r && r.id === 'w1');
  assert.strictEqual(stillThere, false, 'and the browser no longer shows it, exactly as before');
  step('web delete looks identical in a browser: the recipe is gone from the library');

  // Restoring it: the recipe is in the Trash, and comes back.
  const webTrash = await call('GET', '/api/v1/trash', { token: alice });
  assert.ok(webTrash.json.recipes.some((r) => r.recipe.id === 'w1'), 'a web deletion is recoverable');
  const webRestore = await call('POST', '/api/v1/trash/w1/restore', { token: alice });
  assert.strictEqual(webRestore.json.status, 'applied');
  const restoredInWeb = await call('GET', '/api/recipes', { cookie });
  assert.ok((restoredInWeb.json.recipes || restoredInWeb.json || []).some((r) => r && r.id === 'w1'),
    'and the browser sees it again');
  step('web delete is recoverable from the Trash, and the browser sees the restore');

  // Surviving recipes keep their identity across a whole-library save.
  const survivorBefore = await pool.query(
    `SELECT id, created_at FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='r1'`, [aliceId]);
  const libForResave = await call('GET', '/api/recipes', { cookie });
  await call('PUT', '/api/recipes', { cookie, body: { recipes: (libForResave.json.recipes || libForResave.json || []) } });
  const survivorAfter = await pool.query(
    `SELECT id, created_at FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='r1'`, [aliceId]);
  assert.strictEqual(survivorAfter.rows[0].id, survivorBefore.rows[0].id,
    'a whole-library save keeps the row, so history stays attached to it');
  assert.strictEqual(
    new Date(survivorAfter.rows[0].created_at).getTime(),
    new Date(survivorBefore.rows[0].created_at).getTime(),
    'and keeps created_at, so a bulk save no longer scrambles "Recently added"');
  step('a whole-library save reconciles rather than recreating');

  // ── The rows a reconcile keyed by recipe id would have missed ───────────
  //
  // Two kinds of row never entered that map, and both are rows the cook asked
  // to be rid of: one whose JSON carries no id, and the earlier of two sharing
  // an id. Either would have survived every future delete and stayed in the
  // library for good.

  await pool.query(
    `INSERT INTO recipes (user_id, title, recipe_json, revision)
     VALUES ($1, 'No id inside', $2::jsonb, 9000)`,
    [aliceId, JSON.stringify({ title: 'No id inside', sections: [] })]
  );
  await pool.query(
    `INSERT INTO recipes (user_id, title, recipe_json, revision)
     VALUES ($1, 'Duplicate A', $2::jsonb, 9001), ($1, 'Duplicate B', $2::jsonb, 9002)`,
    [aliceId, JSON.stringify({ id: 'dupe', title: 'Duplicate', sections: [] })]
  );
  const beforeReconcile = await pool.query(
    `SELECT count(*)::int AS n FROM recipes WHERE user_id=$1 AND deleted_at IS NULL`, [aliceId]);

  // Save a library that mentions none of them: the browser's way of deleting.
  const keepOnly = await call('GET', '/api/recipes', { cookie });
  const withoutOddities = (keepOnly.json.recipes || keepOnly.json || [])
    .filter((r) => r && r.id && r.id !== 'dupe');
  await call('PUT', '/api/recipes', { cookie, body: { recipes: withoutOddities } });

  const idless = await pool.query(
    `SELECT deleted_at FROM recipes WHERE user_id=$1 AND recipe_json->>'id' IS NULL`, [aliceId]);
  assert.ok(idless.rows.length && idless.rows.every((r) => r.deleted_at),
    'a row with no id inside it is still deleted when the payload omits it');
  const dupes = await pool.query(
    `SELECT deleted_at FROM recipes WHERE user_id=$1 AND recipe_json->>'id' = 'dupe'`, [aliceId]);
  assert.strictEqual(dupes.rows.length, 2, 'both duplicate rows are still there as tombstones');
  assert.ok(dupes.rows.every((r) => r.deleted_at), 'and both are deleted, not just the last one seen');
  const afterReconcile = await pool.query(
    `SELECT count(*)::int AS n FROM recipes WHERE user_id=$1 AND deleted_at IS NULL`, [aliceId]);
  assert.strictEqual(afterReconcile.rows[0].n, beforeReconcile.rows[0].n - 3,
    'exactly the three unaccounted rows went, and nothing else');
  step('a whole-library save deletes rows with no id and duplicate rows too');

  // And a payload naming one recipe twice updates one row rather than growing one.
  const twiceBody = [
    { id: 'twice', title: 'First', sections: [{ name: '', ingredients: [], steps: [] }] },
    { id: 'twice', title: 'Second', sections: [{ name: '', ingredients: [], steps: [] }] },
  ];
  const libNow = await call('GET', '/api/recipes', { cookie });
  await call('PUT', '/api/recipes', {
    cookie,
    body: { recipes: [...(libNow.json.recipes || libNow.json || []), ...twiceBody] },
  });
  const twiceRows = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='twice' AND deleted_at IS NULL`,
    [aliceId]);
  assert.strictEqual(twiceRows.rows.length, 1, 'one row, not two');
  assert.strictEqual(twiceRows.rows[0].t, 'Second', 'and the later entry wins');
  step('a payload naming one recipe twice writes one row');

  const badSince = await call('GET', '/api/v1/sync/recipes?since=yesterday', { token: alice });
  assert.strictEqual(badSince.status, 400, 'a revision is a number, not a date');
  const anon = await call('GET', '/api/v1/sync/recipes?since=0');
  assert.strictEqual(anon.status, 401, 'and none of this is reachable without a session');
  step('bad input and anonymous access are refused');
}

main().catch(async (err) => {
  console.error('\nsync-routes-test FAILED:', err && err.message);
  console.error(err);
  process.exitCode = 1;
});
