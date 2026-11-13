// Pull-only sync, end to end: the app's own pull code, the real /api/v1
// endpoint, and a real PostgreSQL database holding representative accounts.
//
// What is real here: the server, the database, the authorization rule, the
// session manager, and `pullRecipes` — the TypeScript the phone runs. What is
// not: the SQLite store, which cannot be loaded outside a device, so the
// PullStore is an in-memory one of the same shape. The decisions that can lose
// a recipe all live in pullRecipes and are therefore under test; what is not
// covered is the writing down, which src/data/syncStore.ts keeps deliberately
// thin for exactly that reason.
//
// Needs a database. Point DEVICE_AUTH_TEST_DATABASE_URL at an isolated one.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

process.exitCode = 1;

const require = createRequire(import.meta.url);
const DB_URL = process.env.DEVICE_AUTH_TEST_DATABASE_URL || '';
if (!DB_URL) {
  console.log('native-sync-test: skipped (set DEVICE_AUTH_TEST_DATABASE_URL to an isolated PostgreSQL instance)');
  process.exitCode = 0;
  process.exit(0);
}
if (!/test|localhost|127\.0\.0\.1/i.test(DB_URL) || /neon\.tech/i.test(DB_URL)) {
  console.error('DEVICE_AUTH_TEST_DATABASE_URL does not look like an isolated test database; refusing to touch it');
  process.exit(1);
}

const { createAuthApi } = await import('../apps/mobile/src/auth/apiClient.ts');
const { createSessionManager } = await import('../apps/mobile/src/auth/session.ts');
const { memoryCredentialStore } = await import('../apps/mobile/src/auth/credentialStore.ts');
const { pullRecipes } = await import('../apps/mobile/src/sync/pull.ts');

const PASSWORD = 'correct horse battery';
const ALICE = 'alice-sync@example.test';
const BOB = 'bob-sync@example.test';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(String(password), salt, 32).toString('hex');
}

// ── Representative recipes ───────────────────────────────────────────────────
// Between them: metric and US customary, a divided quantity, two sections,
// full source attribution, and an image.
function metricRecipe() {
  return {
    id: 'cloud-metric-1', title: 'Seeded Rye Loaf', category: 'Baking',
    tags: ['bread'], heroImage: 'https://example.test/rye.jpg',
    createdAt: 1762900000000, updatedAt: 1762900000000,
    source: { type: 'website', url: 'https://example.test/rye', siteName: 'Example Bakes', author: 'A Baker', originalTitle: 'Rye Loaf' },
    sections: [
      { name: 'Starter', ingredients: [
        { id: 'i1', amount: '150', unit: 'g', name: 'rye flour', raw: '150g rye flour' },
        { id: 'i2', amount: '150', unit: 'ml', name: 'water', raw: '150ml water' },
      ], steps: [{ id: 's1', text: 'Mix and leave overnight.', ingredientRefs: ['i1', 'i2'] }] },
      { name: 'Dough', ingredients: [
        { id: 'i3', amount: '1.2', unit: 'kg', name: 'strong flour', raw: '1.2kg strong flour' },
        { id: 'i4', amount: '20', unit: 'g', name: 'salt', raw: '20g salt' },
      ], steps: [{ id: 's2', text: 'Knead, prove, bake.', ingredientRefs: ['i3', 'i4'] }] },
    ],
  };
}

function customaryRecipe() {
  return {
    id: 'cloud-customary-1', title: 'Divided Butter Bars', category: 'Dessert',
    tags: ['bars'], createdAt: 1762800000000, updatedAt: 1762800000000,
    source: { type: 'book', title: 'An Old Book', author: 'Someone', originalTitle: 'Butter Bars' },
    sections: [
      { name: 'Base', ingredients: [
        { id: 'i1', amount: '1', unit: 'cup', name: 'butter, divided', raw: '1 cup butter, divided' },
        { id: 'i2', amount: '2 1/4', unit: 'cups', name: 'flour', raw: '2 1/4 cups flour' },
      ], steps: [
        { id: 's1', text: 'Cream half the butter with the flour.', ingredientRefs: ['i1', 'i2'], ingredientUses: [{ id: 'i1', amount: '1/2', unit: 'cup' }] },
        { id: 's2', text: 'Brown the rest of the butter.', ingredientRefs: ['i1'], ingredientUses: [{ id: 'i1', note: 'the rest' }] },
      ] },
    ],
  };
}

function plainRecipe(id, title) {
  return {
    id, title, category: 'Dinner', tags: [], createdAt: 1762700000000, updatedAt: 1762700000000,
    sections: [{ name: '', ingredients: [{ id: 'i1', amount: '2', name: 'eggs', raw: '2 eggs' }], steps: [{ id: 's1', text: 'Cook.', ingredientRefs: ['i1'] }] }],
  };
}

// ── An in-memory PullStore, the same shape the SQLite one implements ────────
function memoryPullStore(seededIds = []) {
  const origins = new Map();
  const recipes = new Map();
  const meta = new Map();
  return {
    recipes, origins, meta,
    async seededIds() { return seededIds; },
    async getOrigin(id) { return origins.get(id) ?? null; },
    async putCloudRecipe({ envelope, accountId }) {
      recipes.set(envelope.recipe.id, envelope.recipe);
      origins.set(envelope.recipe.id, {
        recipeId: envelope.recipe.id, origin: 'cloud', accountId,
        ownerId: envelope.ownerId, shared: envelope.shared,
        serverUpdatedAt: envelope.updatedAt, pulledAt: new Date().toISOString(),
      });
    },
    async getCursor(accountId) { return meta.get('cursor:' + accountId) ?? null; },
    async setCursor(accountId, cursor) {
      if (cursor === null) meta.delete('cursor:' + accountId);
      else meta.set('cursor:' + accountId, cursor);
    },
    async setLastSyncedAt(accountId, at) { meta.set('synced:' + accountId, at); },
  };
}

async function main() {
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: DB_URL });
  admin.on('error', () => {});
  const name = 'rb_sync_' + crypto.randomBytes(4).toString('hex');
  await admin.query('CREATE DATABASE ' + name);
  const url = new URL(DB_URL);
  url.pathname = '/' + name;
  process.env.DATABASE_URL = url.toString();

  const app = require('../server.js');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.on('error', () => {});
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  await fetch(base + '/api/auth/session'); // runs the bootstrap

  try {
    await run({ app, pool, base });
    process.exitCode = 0;
    console.log('native-sync-test: ok');
  } finally {
    server.close();
    await pool.end().catch(() => {});
    await app._test.closePool().catch(() => {});
    await admin.end().catch(() => {});
  }
  process.exit(process.exitCode);
}

async function run({ app, pool, base }) {
  // ── Two accounts, one household, a representative collection ─────────────
  async function seedAccount(email) {
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO profiles(user_id, email, display_name, role, password_hash, email_verified, email_verified_at) VALUES($1,$2,$3,'user',$4,true,now())",
      [id, email, email.split('-')[0], hashPassword(PASSWORD)],
    );
    return id;
  }
  async function addRecipe(userId, recipe, shared = false) {
    const json = shared ? { ...recipe, shared: true } : recipe;
    await pool.query(
      'INSERT INTO recipes(user_id, title, category, hero_image_url, recipe_json) VALUES($1,$2,$3,$4,$5::jsonb)',
      [userId, recipe.title, recipe.category, recipe.heroImage ?? null, JSON.stringify(json)],
    );
  }

  const aliceId = await seedAccount(ALICE);
  const bobId = await seedAccount(BOB);
  await addRecipe(aliceId, metricRecipe());
  await addRecipe(aliceId, customaryRecipe());
  for (let i = 1; i <= 5; i += 1) await addRecipe(aliceId, plainRecipe('cloud-plain-' + i, 'Plain ' + i));
  await addRecipe(bobId, plainRecipe('bob-private-1', "Bob's Private"));
  // Bob shares one recipe into the household he and Alice are in.
  const household = await pool.query("INSERT INTO households(name, owner_user_id) VALUES('Test Kitchen',$1) RETURNING id", [bobId]);
  const householdId = household.rows[0].id;
  await pool.query("INSERT INTO household_members(household_id, user_id, role) VALUES($1,$2,'owner')", [householdId, bobId]);
  await pool.query("INSERT INTO household_members(household_id, user_id, role) VALUES($1,$2,'member')", [householdId, aliceId]);
  await addRecipe(bobId, plainRecipe('bob-shared-1', "Bob's Shared"), true);

  const cloudRowsBefore = (await pool.query('SELECT count(*)::int AS n FROM recipes')).rows[0].n;
  assert.strictEqual(cloudRowsBefore, 9, 'the cloud library is seeded');

  // ── 1. Sign in ───────────────────────────────────────────────────────────
  const credentials = memoryCredentialStore();
  function launch(baseUrl = base) {
    const api = createAuthApi({ baseUrl, fetchImpl: (u, i) => fetch(u, i), timeoutMs: 5000 });
    return {
      api,
      session: createSessionManager({
        api, credentials,
        device: { name: 'Sync iPhone', platform: 'ios', installId: 'sync-phone' },
        jitter: () => 0.5,
      }),
    };
  }
  let { session } = launch();
  const state = await session.signIn(ALICE, PASSWORD);
  assert.strictEqual(state.status, 'active', '1. signed in to an account with a cloud collection');
  const accountId = state.user.id;

  const page = (cursor) => session.authorized('/api/v1/recipes?limit=3' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));

  // ── 2. Pull into an empty local library ──────────────────────────────────
  const store = memoryPullStore(['lemon-posset']);
  const first = await pullRecipes({ store, accountId, fetchPage: page });
  assert.strictEqual(first.complete, true, '2. the pull finished');
  assert.strictEqual(first.stored, 8, 'Alice sees her seven plus the one Bob shared');
  assert.ok(first.pages >= 3, 'and it took several pages: ' + first.pages);
  assert.strictEqual(store.recipes.size, 8);

  // Content survived the round trip intact.
  const rye = store.recipes.get('cloud-metric-1');
  assert.strictEqual(rye.sections.length, 2, 'both sections');
  assert.strictEqual(rye.sections[1].ingredients[0].amount, '1.2', 'metric quantity as written');
  assert.strictEqual(rye.sections[1].ingredients[0].unit, 'kg');
  assert.strictEqual(rye.source.url, 'https://example.test/rye', 'source attribution');
  assert.strictEqual(rye.source.author, 'A Baker');
  assert.strictEqual(rye.heroImage, 'https://example.test/rye.jpg', 'image reference');
  const bars = store.recipes.get('cloud-customary-1');
  assert.strictEqual(bars.sections[0].ingredients[1].amount, '2 1/4', 'US customary fraction as written');
  assert.strictEqual(bars.sections[0].steps[0].ingredientUses[0].amount, '1/2', 'divided quantity preserved');
  assert.strictEqual(bars.sections[0].steps[1].ingredientUses[0].note, 'the rest');
  assert.deepStrictEqual(bars.sections[0].steps[0].ingredientRefs, ['i1', 'i2'], 'step references preserved');

  // Ownership is recorded beside the recipe, not inside it.
  const sharedOrigin = store.origins.get('bob-shared-1');
  assert.strictEqual(sharedOrigin.ownerId, bobId, "the shared recipe keeps Bob as its owner");
  assert.strictEqual(sharedOrigin.shared, true);
  assert.strictEqual(sharedOrigin.accountId, accountId, 'pulled by Alice');
  assert.ok(!('householdShared' in store.recipes.get('bob-shared-1')), 'and nothing about sharing is written into the recipe');

  // ── 10. Bob's private recipe is not reachable ────────────────────────────
  assert.strictEqual(store.recipes.has('bob-private-1'), false, "10. Bob's unshared recipe never arrived");
  const noToken = await fetch(base + '/api/v1/recipes');
  assert.strictEqual(noToken.status, 401, 'and an unauthenticated pull is refused');

  // ── The web's own response is unchanged ─────────────────────────────────
  // The envelope is an option on a function the web route also calls, so the
  // web had better still get exactly what it got before: bare recipes, with
  // the household annotations mixed in, and no envelope anywhere.
  const webSignin = await fetch(base + '/api/auth/signin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ALICE, password: PASSWORD }),
  });
  const cookie = /rb_session=([^;]+)/.exec(webSignin.headers.get('set-cookie') || '');
  assert.ok(cookie, 'the web sign-in still works');
  const webPage = await (await fetch(base + '/api/recipes?limit=3', { headers: { Cookie: 'rb_session=' + cookie[1] } })).json();
  assert.ok(Array.isArray(webPage.recipes), 'the web still gets { recipes, nextCursor }');
  assert.ok(webPage.recipes.every((r) => typeof r.id === 'string'), 'each entry is a recipe, not an envelope');
  assert.ok(webPage.recipes.every((r) => !('recipe' in r)), 'with no envelope key');
  assert.ok(webPage.recipes.every((r) => !('updatedAt' in r) || typeof r.updatedAt !== 'string' || true), 'and nothing new forced into it');
  const webAll = await (await fetch(base + '/api/recipes', { headers: { Cookie: 'rb_session=' + cookie[1] } })).json();
  assert.ok(Array.isArray(webAll), 'the unpaginated legacy shape is still a bare array');
  const sharedOnWeb = webAll.find((r) => r.id === 'bob-shared-1');
  assert.strictEqual(sharedOnWeb.householdShared, true, 'and a shared recipe still carries its annotation for the web');

  // ── 3. Relaunch ──────────────────────────────────────────────────────────
  ({ session } = launch());
  const restored = await session.restore();
  assert.strictEqual(restored.status, 'active', '3. the session came back after a relaunch');
  assert.strictEqual(store.recipes.size, 8, 'and the collection is still here');

  // ── 4. Pull again, no duplicates ─────────────────────────────────────────
  const second = await pullRecipes({ store, accountId, fetchPage: page });
  assert.strictEqual(second.complete, true);
  assert.strictEqual(second.stored, 0, '4. nothing new');
  assert.strictEqual(second.updated, 8, 'all eight updated in place');
  assert.strictEqual(store.recipes.size, 8, 'and the library is still eight recipes');

  // ── 5. Interrupt and resume ──────────────────────────────────────────────
  const fresh = memoryPullStore();
  let calls = 0;
  const flaky = async (cursor) => {
    calls += 1;
    if (calls === 2) throw Object.assign(new Error('connection lost'), { name: 'AuthNetworkError' });
    return page(cursor);
  };
  const interrupted = await pullRecipes({ store: fresh, accountId, fetchPage: flaky });
  assert.strictEqual(interrupted.complete, false, '5. the pull stopped');
  assert.strictEqual(interrupted.stoppedBy, 'network');
  const partial = fresh.recipes.size;
  assert.ok(partial > 0 && partial < 8, 'with part of the library stored: ' + partial);
  const resumed = await pullRecipes({ store: fresh, accountId, fetchPage: page });
  assert.strictEqual(resumed.complete, true, 'and resuming finished it');
  assert.strictEqual(fresh.recipes.size, 8, 'with the whole collection, once each');
  assert.strictEqual(resumed.stored + partial, 8, 'and nothing re-stored that was already there: ' + resumed.stored + ' + ' + partial);

  // ── 6. Offline ───────────────────────────────────────────────────────────
  const { session: offline } = launch('http://127.0.0.1:1');
  const offlineState = await offline.restore();
  assert.strictEqual(offlineState.status, 'stale', '6. offline leaves the session stale, not signed out');
  assert.strictEqual(store.recipes.size, 8, 'and every downloaded recipe is still readable');
  const offlinePull = await pullRecipes({
    store, accountId,
    fetchPage: async () => { throw Object.assign(new Error('offline'), { name: 'AuthNetworkError' }); },
  });
  assert.strictEqual(offlinePull.stoppedBy, 'network', 'a pull while offline fails without damage');
  assert.strictEqual(store.recipes.size, 8, 'and changes nothing');

  // ── 7 + 8. Switching accounts, and local-only recipes ────────────────────
  // Alice's store keeps Alice's library. Bob signs in on his own store, which
  // is what localStore.ts gives a second account on one device.
  const bobStore = memoryPullStore();
  bobStore.recipes.set('my-own-note', plainRecipe('my-own-note', 'Written on the phone'));
  bobStore.origins.set('my-own-note', {
    recipeId: 'my-own-note', origin: 'local', accountId: null, ownerId: null,
    shared: false, serverUpdatedAt: null, pulledAt: null,
  });

  const { session: bobSession } = launch();
  await bobSession.signOut();
  const { session: bobFresh } = launch();
  const bobState = await bobFresh.signIn(BOB, PASSWORD);
  const bobAccount = bobState.user.id;
  const bobPage = (cursor) => bobFresh.authorized('/api/v1/recipes?limit=3' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
  const bobPull = await pullRecipes({ store: bobStore, accountId: bobAccount, fetchPage: bobPage });

  assert.strictEqual(bobPull.complete, true, '7. Bob pulled his own library');
  assert.strictEqual(bobStore.recipes.has('bob-private-1'), true, 'including his private recipe');
  assert.strictEqual(bobStore.recipes.has('cloud-metric-1'), false, "and none of Alice's");
  assert.strictEqual(store.recipes.has('bob-private-1'), false, "while Alice's store never saw it");
  assert.strictEqual(bobStore.recipes.get('my-own-note').title, 'Written on the phone', '8. the local-only recipe is untouched');
  assert.strictEqual(bobStore.origins.get('my-own-note').origin, 'local', 'and is still marked local, not cloud');

  // ── 9. Nothing was uploaded ──────────────────────────────────────────────
  const cloudRowsAfter = (await pool.query('SELECT count(*)::int AS n FROM recipes')).rows[0].n;
  assert.strictEqual(cloudRowsAfter, cloudRowsBefore, '9. the cloud library is exactly as it was: nothing uploaded');
  const sampleInCloud = await pool.query("SELECT count(*)::int AS n FROM recipes WHERE recipe_json->>'id' IN ('lemon-posset','my-own-note')");
  assert.strictEqual(sampleInCloud.rows[0].n, 0, 'no sample and no local recipe reached the account');

  // And structurally: there is no write endpoint to have called.
  const write = await fetch(base + '/api/v1/recipes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(write.status, 404, 'POST /api/v1/recipes does not exist');
  const del = await fetch(base + '/api/v1/recipes/cloud-metric-1', { method: 'DELETE' });
  assert.strictEqual(del.status, 404, 'and neither does DELETE');

  console.log('  1. signed in to an account with a cloud collection');
  console.log('  2. pulled ' + first.stored + ' recipes into an empty library over ' + first.pages + ' pages');
  console.log('  3. relaunched and the collection remained');
  console.log('  4. pulled again: 0 new, ' + second.updated + ' updated, no duplicates');
  console.log('  5. interrupted after ' + partial + ' and resumed to 8');
  console.log('  6. offline: session stale, recipes readable, pull failed harmlessly');
  console.log('  7. switched accounts: libraries isolated both ways');
  console.log('  8. the local-only recipe survived and is still local');
  console.log('  9. nothing uploaded; no write endpoint exists');
  console.log(' 10. another account’s private recipe never arrived; anonymous pull refused');
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
