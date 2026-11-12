// The twelve journeys, walked by the app's own code against the real server.
//
// Not a unit test and not a mock: the session manager imported here is the
// TypeScript the phone runs, and the server it talks to is Express listening on
// an ephemeral port. What is swapped out is named in the header line the script
// prints, so nobody has to guess how much of it was real.
//
//   Default           an in-memory device store. No database. This is CI.
//   With a database   set DEVICE_AUTH_TEST_DATABASE_URL to an isolated
//                     PostgreSQL instance and the whole thing runs against real
//                     SQL, including the two journeys that need one.
//
// Run with `node --experimental-strip-types`.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

process.exitCode = 1;

const require = createRequire(import.meta.url);
const DB_URL = process.env.DEVICE_AUTH_TEST_DATABASE_URL || '';
if (DB_URL && (!/test|localhost|127\.0\.0\.1/i.test(DB_URL) || /neon\.tech/i.test(DB_URL))) {
  console.error('DEVICE_AUTH_TEST_DATABASE_URL does not look like an isolated test database; refusing to touch it');
  process.exit(1);
}

const PASSWORD = 'correct horse battery';
const ALICE = 'alice@example.test';
const BOB = 'bob@example.test';

let clock = Date.now();
const now = () => clock;

const { createAuthApi } = await import('../apps/mobile/src/auth/apiClient.ts');
const { createSessionManager } = await import('../apps/mobile/src/auth/session.ts');
const { memoryCredentialStore } = await import('../apps/mobile/src/auth/credentialStore.ts');
const { memoryDeviceState } = await import('../apps/mobile/src/auth/deviceState.ts');
const { restoreSession, afterSignIn, afterSignOut } = await import('../apps/mobile/src/auth/restore.ts');
const { BASE_LOCAL_STORE } = await import('../apps/mobile/src/auth/localStore.ts');

const deviceAuth = require('../lib/device-auth.js');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(String(password), salt, 32).toString('hex');
}

function journey(n, title) {
  console.log(`  ${String(n).padStart(2, ' ')}. ${title}`);
}

// ---------------------------------------------------------------------------
// Two ways to stand the server up. Everything below is written against the
// result, so the journeys do not know which one they got.
// ---------------------------------------------------------------------------

async function setupWithDatabase() {
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: DB_URL });
  const name = 'rb_journeys_' + crypto.randomBytes(4).toString('hex');
  await admin.query('CREATE DATABASE ' + name);
  const url = new URL(DB_URL);
  url.pathname = '/' + name;
  process.env.DATABASE_URL = url.toString();

  const app = require('../server.js');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  // The bootstrap runs on the first request that uses the pool.
  await fetch(base + '/api/auth/session');

  async function seed(email, { verified }) {
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO profiles(user_id, email, display_name, role, password_hash, email_verified, email_verified_at) VALUES($1,$2,$3,'user',$4,$5,$6)",
      [id, email, email.split('@')[0], hashPassword(PASSWORD), verified, verified ? new Date() : null]
    );
    return id;
  }

  return {
    label: 'real PostgreSQL',
    base,
    seed,
    async confirmEmail(userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      await pool.query("INSERT INTO email_verification_tokens(token_hash, user_id, expires_at) VALUES($1,$2, now() + interval '1 hour')", [app._test.hashToken(token), userId]);
      const res = await fetch(base + '/api/auth/verify-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      });
      return res.status === 200;
    },
    async close() {
      server.close();
      await pool.end().catch(() => {});
      await app._test.closePool().catch(() => {});
      await admin.query('DROP DATABASE IF EXISTS ' + name + ' WITH (FORCE)').catch(() => {});
      await admin.end().catch(() => {});
    },
  };
}

async function setupWithMemory() {
  process.env.DATABASE_URL = '';
  const app = require('../server.js');
  const store = deviceAuth.createMemoryStore([]);
  app._test.useDeviceStore(store);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    label: 'an in-memory device store (no database)',
    base: 'http://127.0.0.1:' + server.address().port,
    async seed(email, { verified }) {
      const id = 'user-' + email.split('@')[0];
      store._users.set(email, {
        user_id: id, email, display_name: email.split('@')[0], role: 'user',
        password_hash: hashPassword(PASSWORD), email_verified: verified, email_verified_at: verified ? new Date() : null,
      });
      return id;
    },
    confirmEmail: null, // needs the verification-token table
    async close() {
      app._test.useDeviceStore(null);
      server.close();
    },
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const env = DB_URL ? await setupWithDatabase() : await setupWithMemory();
  console.log(`native-auth-e2e-test: the app's own session manager against the real server, over ${env.label}`);

  // One phone, one credential store, one device state — they outlive each
  // "launch" exactly as the Keychain and the app's files do.
  const credentials = memoryCredentialStore();
  const device = memoryDeviceState({ fresh: true });
  const descriptor = { name: 'Journey iPhone', platform: 'ios', installId: await device.getInstallId() };

  function launch(baseUrl = env.base) {
    const api = createAuthApi({ baseUrl, fetchImpl: (url, init) => fetch(url, init), timeoutMs: 5000 });
    return createSessionManager({ api, credentials, device: descriptor, now, jitter: () => 0.5 });
  }

  try {
    const aliceId = await env.seed(ALICE, { verified: true });
    await env.seed(BOB, { verified: true });

    // 1 ─────────────────────────────────────────────────────────────────────
    journey(1, 'Open RecipeBox while signed out');
    let session = launch();
    let opened = await restoreSession({ session, credentials, device });
    assert.strictEqual(opened.state.status, 'signed-out', 'a fresh install opens signed out');
    assert.strictEqual(opened.store.name, BASE_LOCAL_STORE, 'and opens the library that is already on the device');

    // 2 ─────────────────────────────────────────────────────────────────────
    journey(2, 'Use existing local recipes offline');
    // The claim this makes is structural: the session manager has no reference
    // to the recipe store, so nothing it does can reach a recipe. The import
    // check that proves it lives in apps/mobile/test/auth.test.ts; here the
    // assertion is that opening with no server at all still yields a usable,
    // signed-out app rather than an error.
    const grounded = launch('http://127.0.0.1:1');
    const groundedOpen = await restoreSession({ session: grounded, credentials, device: memoryDeviceState({ fresh: false }) });
    assert.strictEqual(groundedOpen.state.status, 'signed-out', 'no server, no credential: still just signed out');

    // 3 ─────────────────────────────────────────────────────────────────────
    journey(3, 'Sign in with an existing account');
    let state = await session.signIn(ALICE, PASSWORD);
    assert.strictEqual(state.status, 'active');
    assert.strictEqual(state.user.email, ALICE);
    const store1 = await afterSignIn(device, state.user.id);
    assert.strictEqual(store1.name, BASE_LOCAL_STORE, 'the first account adopts the library already here');
    assert.strictEqual(await device.getClaim(), state.user.id);

    const me = await session.authorized('/api/v1/me');
    assert.strictEqual(me.user.email, ALICE, 'an authenticated call works end to end');

    // 4 + 5 ─────────────────────────────────────────────────────────────────
    journey(4, 'Close and restart the application');
    journey(5, 'Restore the session securely');
    const stored = await credentials.read();
    assert.ok(stored.refreshToken, 'the refresh token is in the credential store');
    assert.ok(!JSON.stringify(stored).includes(stored.refreshToken.slice(0, 0) + 'accessToken'), 'and the access token is not');
    session = launch();                                   // a new process, same storage
    const relaunched = await restoreSession({ session, credentials, device });
    assert.strictEqual(relaunched.state.status, 'active', 'the session comes back without a password');
    assert.strictEqual(relaunched.droppedForeignCredential, false, 'and is not mistaken for a reinstall');
    assert.notStrictEqual((await credentials.read()).refreshToken, stored.refreshToken, 'the refresh token rotated on the way');

    // 6 ─────────────────────────────────────────────────────────────────────
    journey(6, 'Refresh an expired access token');
    const beforeRefresh = (await credentials.read()).refreshToken;
    clock += 890 * 1000;                                   // inside the refresh margin
    const stillWorks = await session.authorized('/api/v1/me');
    assert.strictEqual(stillWorks.user.email, ALICE, 'the call succeeds across a silent refresh');
    assert.notStrictEqual((await credentials.read()).refreshToken, beforeRefresh, 'which rotated again');
    assert.strictEqual(session.state.status, 'active', 'and the session never left active');

    // 7 + 8 ─────────────────────────────────────────────────────────────────
    journey(7, 'Lose network access while cooking');
    const kept = await credentials.read();
    const offline = launch('http://127.0.0.1:1');
    const offlineState = await offline.restore();
    assert.strictEqual(offlineState.status, 'stale', 'unreachable is stale, not signed out');
    assert.strictEqual(offlineState.user.email, ALICE, 'and the app can still say who is signed in');
    assert.strictEqual((await credentials.read()).refreshToken, kept.refreshToken, 'the credential is untouched');

    journey(8, 'Recover after connectivity returns');
    session = launch();
    assert.strictEqual((await session.restore()).status, 'active', 'and it recovers with no password typed');

    // 9 ─────────────────────────────────────────────────────────────────────
    journey(9, 'Revoke the device session');
    const otherPhone = createSessionManager({
      api: createAuthApi({ baseUrl: env.base, fetchImpl: (url, init) => fetch(url, init) }),
      credentials: memoryCredentialStore(),
      device: { name: 'Second phone', platform: 'android', installId: 'journey-second' },
      now, jitter: () => 0.5,
    });
    await otherPhone.signIn(ALICE, PASSWORD);
    const list = await otherPhone.devices();
    assert.strictEqual(list.length, 2, 'both devices are listed');
    const first = list.find((d) => !d.current);
    await otherPhone.revokeDevice(first.id);

    clock += 1000;
    await assert.rejects(() => session.authorized('/api/v1/me'), (err) => err.name === 'AuthApiError', 'the revoked device finds out on its next request');
    assert.strictEqual(session.state.status, 'expired', 'and is signed out by the server');
    assert.strictEqual(await credentials.read(), null, 'throwing its credential away');

    // 10 ────────────────────────────────────────────────────────────────────
    journey(10, 'Sign out without destroying local recipes');
    session = launch();
    await session.signIn(ALICE, PASSWORD);
    await afterSignIn(device, aliceId || (await session.state).user?.id || 'user-alice');
    const signOut = await session.signOut();
    assert.strictEqual(signOut.localDataRetained, true, 'signing out keeps the local library');
    assert.strictEqual(await credentials.read(), null, 'and forgets the credential');
    const ownerBack = await afterSignOut(device);
    assert.strictEqual(ownerBack.name, BASE_LOCAL_STORE, 'the owner signing out stays in their own library');

    // 11 ────────────────────────────────────────────────────────────────────
    journey(11, "Switch accounts without displaying the previous account's private data");
    session = launch();
    const bobState = await session.signIn(BOB, PASSWORD);
    const bobStore = await afterSignIn(device, bobState.user.id);
    assert.strictEqual(bobStore.isolated, true, "a second account gets a library of its own");
    assert.notStrictEqual(bobStore.name, BASE_LOCAL_STORE, "and never opens the first account's");
    const bobMe = await session.authorized('/api/v1/me');
    assert.strictEqual(bobMe.user.email, BOB, 'and the server answers as Bob, not Alice');
    const bobDevices = await session.devices();
    assert.ok(bobDevices.every((d) => d.id !== first.id), "Alice's devices are not in Bob's list");
    const bobOut = await afterSignOut(device);
    assert.strictEqual(bobOut.isolated, true, 'and Bob signing out does not hand him the owner library');
    await session.signOut();

    // 12 ────────────────────────────────────────────────────────────────────
    journey(12, 'Complete email verification for a new account');
    if (!env.confirmEmail) {
      console.log('      skipped: needs a database for the verification-token table.');
      console.log('      Set DEVICE_AUTH_TEST_DATABASE_URL to an isolated PostgreSQL instance to include it.');
    } else {
      const api = createAuthApi({ baseUrl: env.base, fetchImpl: (url, init) => fetch(url, init) });
      const fresh = 'fresh-' + crypto.randomBytes(3).toString('hex') + '@example.test';
      const created = await api.signUp(fresh, PASSWORD, 'Fresh Cook');
      assert.strictEqual(created.verificationRequired, true, 'a new account must confirm its email');

      const newcomer = createSessionManager({
        api, credentials: memoryCredentialStore(),
        device: { name: 'Newcomer', platform: 'ios', installId: 'journey-newcomer' },
        now, jitter: () => 0.5,
      });
      await assert.rejects(
        () => newcomer.signIn(fresh, PASSWORD),
        (err) => err.name === 'AuthApiError' && err.code === 'email_verification_required',
        'and cannot sign in before it does',
      );

      assert.ok(await env.confirmEmail(created.user.id), 'the confirmation link is accepted');
      const confirmed = await newcomer.signIn(fresh, PASSWORD);
      assert.strictEqual(confirmed.status, 'active', 'and then the account signs in');
      assert.strictEqual(confirmed.user.email, fresh);
    }

    process.exitCode = 0;
    console.log('native-auth-e2e-test: ok');
  } finally {
    await env.close();
  }
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
