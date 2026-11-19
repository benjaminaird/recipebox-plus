// Household sharing, end to end: the real server, a real PostgreSQL database,
// the real rules the phone runs.
//
// A3's question is not "can two accounts be in a household" — the server has
// done that for a long time, and `household-test.js` covers it. It is whether
// the PHONE behaves correctly about a recipe it may read and must not change:
// that it sees one, that nothing it does reaches the owner's copy, that "save
// my own copy" produces a recipe of its own, and that losing access takes the
// cached copy and nothing else.
//
// The device's SQLite stands in as a memory store of the same shape, because
// Expo's SQLite does not run under node. The rules themselves are the shipped
// ones: src/sync/household.ts, unmodified.
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
  console.log('native-household-test: skipped (set RECIPE_SYNC_TEST_DATABASE_URL to an isolated PostgreSQL instance)');
  process.exitCode = 0;
  process.exit(0);
}
if (!/test|localhost|127\.0\.0\.1/i.test(DB_URL) || /neon\.tech/i.test(DB_URL)) {
  console.error('database URL does not look isolated; refusing to touch it');
  process.exit(1);
}

const { planHouseholdRead, copyForMyself, mayEdit } = await import('../apps/mobile/src/sync/household.ts');

const PASSWORD = 'correct horse battery';
const DB_NAME = 'rb_house_' + crypto.randomBytes(4).toString('hex');

const steps = [];
const step = (name) => { steps.push(name); console.log('  ' + String(steps.length).padStart(2) + '. ' + name); };

function urlForDatabase(base, name) {
  const u = new URL(base);
  u.pathname = '/' + name;
  return u.toString();
}

function recipe(id, title, over = {}) {
  return {
    id, title, createdAt: 1, updatedAt: 2,
    sections: [{
      name: 'Dough',
      ingredients: [{ id: 'i1', name: 'plain flour', amount: '250', unit: 'g' }],
      steps: [{ id: 's1', text: 'Mix.', ingredientRefs: ['i1'] }],
    }],
    ...over,
  };
}

let base = '';
async function http(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* the assertion will say */ }
  return { status: res.status, json, text };
}

/** Every page of the library view, as the phone's transport reads it. */
async function readLibrary(token) {
  const all = [];
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const q = '?limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const res = await http('GET', '/api/v1/recipes' + q, { token });
    assert.strictEqual(res.status, 200, 'library read: ' + res.text.slice(0, 160));
    all.push(...(res.json.recipes || []));
    cursor = res.json.nextCursor || null;
    if (!cursor) return all;
  }
  throw new Error('library did not end');
}

/** The phone's library, as far as these rules can tell. */
function deviceLibrary() {
  const held = new Map();
  return {
    held,
    list: () => [...held.values()],
    putShared: (envelope) => held.set(envelope.recipe.id, {
      recipeId: envelope.recipe.id, origin: 'cloud', shared: true,
      recipe: envelope.recipe, ownerName: envelope.ownerName,
    }),
    putOwn: (r, origin = 'local') => held.set(r.id, {
      recipeId: r.id, origin, shared: false, recipe: r, ownerName: null,
    }),
    revoke: (ids) => { for (const id of ids) held.delete(id); },
  };
}

async function signUp(email) {
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
  const aliceId = await signUp(aliceEmail);
  const bobId = await signUp(bobEmail);
  await pool.query('UPDATE profiles SET email_verified = true WHERE email IN ($1,$2)', [aliceEmail, bobEmail]);
  const aliceToken = await token(aliceEmail, 'alice-phone');
  const bobToken = await token(bobEmail, 'bob-phone');

  // A household with both of them in it, made the way the product makes one.
  const householdId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO households (id, name, owner_user_id, created_at) VALUES ($1, 'Test kitchen', $2, now())`,
    [householdId, bobId]);
  await pool.query(
    `INSERT INTO household_members (household_id, user_id, role, joined_at)
     VALUES ($1, $2, 'owner', now()), ($1, $3, 'member', now())`,
    [householdId, bobId, aliceId]);
  step('two accounts in one household');

  // ── Bob writes a recipe and shares it ────────────────────────────────────
  const shared = recipe('bobs-bread', "Bob's soda bread", { shared: true, servings: 6, tags: ['Quick'] });
  let push = await http('POST', '/api/v1/sync/recipes', {
    token: bobToken,
    body: { writes: [{ recipe: shared, baseRevision: null, idempotencyKey: crypto.randomUUID() }], deletions: [] },
  });
  assert.strictEqual(push.json.applied.length, 1, 'Bob saved his recipe: ' + push.text.slice(0, 160));

  const bobPrivate = recipe('bobs-private', "Bob's private note");
  push = await http('POST', '/api/v1/sync/recipes', {
    token: bobToken,
    body: { writes: [{ recipe: bobPrivate, baseRevision: null, idempotencyKey: crypto.randomUUID() }], deletions: [] },
  });
  assert.strictEqual(push.json.applied.length, 1);
  step("Bob has one shared recipe and one he has not shared");

  // ── Alice sees the shared one, and only that one ─────────────────────────
  const alicePhone = deviceLibrary();
  alicePhone.putOwn(recipe('alices-own', 'Written on Alice’s phone'));

  let visible = await readLibrary(aliceToken);
  let plan = planHouseholdRead(visible, alicePhone.list());
  for (const e of plan.store) alicePhone.putShared(e);
  alicePhone.revoke(plan.revoke);

  assert.ok(alicePhone.held.has('bobs-bread'), 'the shared recipe reached Alice');
  assert.ok(!alicePhone.held.has('bobs-private'), "and the one Bob did not share did not");
  assert.strictEqual(alicePhone.held.get('bobs-bread').shared, true);
  assert.ok(alicePhone.held.has('alices-own'), 'and her own recipe is untouched');
  step('a household member sees what was shared, and nothing else');

  // ── It carries the owner, the id and the attribution ─────────────────────
  const envelope = visible.find((e) => e.recipe.id === 'bobs-bread');
  assert.strictEqual(envelope.ownerId, bobId, 'the owner is preserved');
  assert.ok(envelope.ownerName, 'and named, so the screen can say whose it is');
  assert.strictEqual(envelope.recipe.id, 'bobs-bread', 'the recipe keeps its id');
  assert.strictEqual(envelope.recipe.servings, 6);
  assert.deepStrictEqual(envelope.recipe.sections[0].steps[0].ingredientRefs, ['i1'],
    'step references survive the trip');
  step('owner, recipe id, ingredient references and shared status all preserved');

  // ── Alice may not change it. The SERVER says so, not just the phone ──────
  assert.strictEqual(mayEdit(alicePhone.held.get('bobs-bread')), false, 'the phone refuses first');

  const stolen = await http('POST', '/api/v1/sync/recipes', {
    token: aliceToken,
    body: {
      writes: [{ recipe: { ...shared, title: 'Alice took it over' }, baseRevision: null, idempotencyKey: crypto.randomUUID() }],
      deletions: [],
    },
  });
  // Alice writing Bob's recipe id does not touch Bob's recipe. Every query on
  // the write path is scoped to the caller, so what she actually created is a
  // recipe of HER OWN that happens to share an id — ids are per-account, and
  // that is why a member can never reach an owner's row by guessing one.
  assert.strictEqual(stolen.status, 200, 'answered rather than erroring');
  const bobsRow = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='bobs-bread'`,
    [bobId]);
  assert.strictEqual(bobsRow.rows[0].t, "Bob's soda bread", "Bob's recipe was not overwritten");
  const alicesCollision = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='bobs-bread'`,
    [aliceId]);
  assert.strictEqual(alicesCollision.rows[0].t, 'Alice took it over',
    'she wrote into her own library, which is the only place she can write');

  const stolenDelete = await http('POST', '/api/v1/sync/recipes', {
    token: aliceToken,
    body: { writes: [], deletions: [{ id: 'bobs-bread', baseRevision: null, idempotencyKey: crypto.randomUUID() }] },
  });
  assert.strictEqual(stolenDelete.status, 200);
  const afterDelete = await pool.query(
    `SELECT deleted_at FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='bobs-bread'`, [bobId]);
  assert.strictEqual(afterDelete.rows[0].deleted_at, null, "nor deleted by a member");
  step("only the owner may edit or delete the original — enforced on the server");

  // That collision was this test proving a point, not something a phone would
  // ever do: the app refuses before it gets there, and the row would otherwise
  // confuse the revocation check below, which is about Bob's recipe.
  await pool.query(
    `DELETE FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='bobs-bread'`, [aliceId]);

  // ── Save my own copy ─────────────────────────────────────────────────────
  const copy = copyForMyself(
    alicePhone.held.get('bobs-bread').recipe,
    { ownerName: alicePhone.held.get('bobs-bread').ownerName },
    'bobs-bread-copy-1', 9_000);
  alicePhone.putOwn(copy);

  push = await http('POST', '/api/v1/sync/recipes', {
    token: aliceToken,
    body: { writes: [{ recipe: copy, baseRevision: null, idempotencyKey: crypto.randomUUID() }], deletions: [] },
  });
  assert.strictEqual(push.json.applied.length, 1, 'the copy is Alice’s to save: ' + push.text.slice(0, 160));
  assert.strictEqual(copy.sections[0].ingredients[0].amount, '250', 'quantities as written');
  assert.strictEqual(copy.sections[0].ingredients[0].unit, 'g', 'a copy is not a conversion');
  assert.deepStrictEqual(copy.sections[0].steps[0].ingredientRefs, ['i1']);
  assert.deepStrictEqual(copy.tags, ['Quick']);
  assert.match(copy.source.reference, /Copied from/, 'and it says where it came from');

  // And it is PRIVATE. `shared` is a field on the recipe body and the field
  // the server reads to decide who may see it, so copying the body wholesale
  // used to publish the copy to the household the moment it was uploaded --
  // something the cook never asked for. Checked at the server, because that
  // is where the consequence would be.
  assert.ok(!copy.shared, 'the copy is not marked shared');
  const bobsView = await readLibrary(bobToken);
  assert.ok(!bobsView.some((e) => e.recipe.id === copy.id),
    "and Bob cannot see Alice's copy of his own recipe");
  step('save my own copy: a new recipe, this account’s, private, with everything carried over');

  // ── The two are independent in both directions ───────────────────────────
  const bobsRevision = (await pool.query(
    `SELECT revision FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='bobs-bread'`, [bobId])).rows[0].revision;
  push = await http('POST', '/api/v1/sync/recipes', {
    token: bobToken,
    body: {
      writes: [{ recipe: { ...shared, title: "Bob's soda bread, revised" }, baseRevision: Number(bobsRevision), idempotencyKey: crypto.randomUUID() }],
      deletions: [],
    },
  });
  assert.strictEqual(push.json.applied.length, 1);

  const aliceCopyRow = await pool.query(
    `SELECT recipe_json->>'title' AS t FROM recipes WHERE user_id=$1 AND recipe_json->>'id'=$2`,
    [aliceId, copy.id]);
  assert.strictEqual(aliceCopyRow.rows[0].t, "Bob's soda bread",
    "Bob's later edit did not reach Alice's copy");

  visible = await readLibrary(aliceToken);
  plan = planHouseholdRead(visible, alicePhone.list());
  for (const e of plan.store) alicePhone.putShared(e);
  assert.strictEqual(alicePhone.held.get('bobs-bread').recipe.title, "Bob's soda bread, revised",
    'while the shared original does update');
  assert.strictEqual(alicePhone.held.get(copy.id).recipe.title, "Bob's soda bread",
    'and the copy still does not');
  step('edits to the original and to the copy do not reach each other');

  // ── Losing access ────────────────────────────────────────────────────────
  await pool.query('DELETE FROM household_members WHERE household_id=$1 AND user_id=$2',
    [householdId, aliceId]);

  visible = await readLibrary(aliceToken);
  assert.ok(!visible.some((e) => e.recipe.id === 'bobs-bread'),
    'the server stops showing it at once');

  plan = planHouseholdRead(visible, alicePhone.list());
  assert.deepStrictEqual(plan.revoke, ['bobs-bread'], 'and the phone is told to forget it');
  alicePhone.revoke(plan.revoke);

  assert.ok(!alicePhone.held.has('bobs-bread'), 'the cached copy is gone');
  assert.ok(alicePhone.held.has(copy.id), 'the copy Alice saved is hers and stays');
  assert.ok(alicePhone.held.has('alices-own'), 'and so is everything she wrote');

  const bobStillHasIt = await pool.query(
    `SELECT deleted_at FROM recipes WHERE user_id=$1 AND recipe_json->>'id'='bobs-bread'`, [bobId]);
  assert.strictEqual(bobStillHasIt.rows[0].deleted_at, null,
    "and nothing about losing access touched the owner's recipe");
  step('losing access removes the cached copy, and only that');

  // ── An offline device cannot be told ─────────────────────────────────────
  //
  // Stated rather than worked around. A phone with no connection keeps what
  // it has: that is what local-first means, and no amount of design makes a
  // revocation arrive somewhere unreachable. What CAN be guaranteed is that
  // the first successful read afterwards acts on it, which is what the plan
  // above does — revocation is decided by absence from a complete read, so
  // a device that has been away for a month is corrected the moment it
  // connects, without needing to have been told anything while it was gone.
  const stale = deviceLibrary();
  stale.putShared({ recipe: shared, serverId: 'x', ownerId: bobId, ownerName: 'Bob', shared: true,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
  stale.putOwn(recipe('offline-written', 'Written while away'));
  const afterReconnect = planHouseholdRead(await readLibrary(aliceToken), stale.list());
  assert.deepStrictEqual(afterReconnect.revoke, ['bobs-bread']);
  assert.ok(!afterReconnect.revoke.includes('offline-written'));
  step('a device that was away is corrected by its first complete read');
}

async function main() {
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: DB_URL });
  admin.on('error', () => {});
  await admin.query('CREATE DATABASE ' + DB_NAME);

  process.env.DATABASE_URL = urlForDatabase(DB_URL, DB_NAME);
  // Writes are enabled here and only here: an isolated database, in a process
  // this test owns.
  process.env.RECIPEBOX_SYNC_WRITES = 'on';

  const app = require('../server');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.on('error', () => {});
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;

  try {
    await run(pool);
    console.log('\nnative-household-test: ok (' + steps.length + ' checks)');
    process.exitCode = 0;
  } finally {
    server.close();
    await pool.end().catch(() => {});
    await app._test.closePool().catch(() => {});
    await admin.query('DROP DATABASE IF EXISTS ' + DB_NAME).catch(() => {});
    await admin.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('\nnative-household-test FAILED:', err.message);
  console.error(err);
  process.exitCode = 1;
});
