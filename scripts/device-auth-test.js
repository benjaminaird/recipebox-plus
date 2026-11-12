// The device-session lifecycle: issuance, rotation, replay detection,
// revocation, expiry (scripts/device-auth-routes-test.js covers the HTTP
// surface). Offline, no database, no network.
//
// Every case runs against BOTH store implementations. The in-memory store is
// what CI exercises; the Postgres store joins in when DATABASE_URL is set, so
// the same assertions prove the SQL rather than a second set of assertions
// hoping to. A divergence fails here instead of in production.
//
// Tokens are never printed. Failure messages carry a fingerprint (the first
// eight hex of the hash), which identifies a token without being one.

const assert = require('assert');
const crypto = require('crypto');
const deviceAuth = require('../lib/device-auth');
const {
  signIn, refresh, authenticate, signOut, listDevices, revokeDevice, revokeAllDevices,
  createMemoryStore, createPgStore, ensureSchema, hashToken, tokenFingerprint,
  ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS, DEVICE_ABSOLUTE_LIFETIME_SECONDS,
  REFRESH_REUSE_GRACE_SECONDS, MAX_DEVICES_PER_USER, DeviceAuthError,
} = deviceAuth;

// The server's real scrypt verifier, so "a valid password" means here exactly
// what it means to the web app.
const { hashToken: serverHashToken } = require('../server')._test;
assert.strictEqual(serverHashToken('x'), hashToken('x'), 'the two modules hash tokens identically');

const PASSWORD = 'correct horse battery';
const WRONG = 'incorrect horse battery';
function fakeVerify(password, stored) { return String(password) === String(stored); }

const ALICE = { user_id: 'user-alice', email: 'alice@example.com', display_name: 'Alice', role: 'user', password_hash: PASSWORD, email_verified: true, email_verified_at: new Date('2026-01-01T00:00:00Z') };
const BOB = { user_id: 'user-bob', email: 'bob@example.com', display_name: 'Bob', role: 'user', password_hash: PASSWORD, email_verified: true, email_verified_at: null };
const CARLA = { user_id: 'user-carla', email: 'carla@example.com', display_name: 'Carla', role: 'user', password_hash: PASSWORD, email_verified: false, email_verified_at: null };

const T0 = new Date('2026-11-12T09:00:00Z');
const at = (seconds) => new Date(T0.getTime() + (seconds * 1000));

// A suite that stops halfway must not pass. An await on a promise that never
// settles empties the event loop, and node then exits 0 with most of the file
// unrun -- so the exit code starts as a failure and is cleared only where the
// suite announces that it finished.
process.exitCode = 1;

async function caught(fn) {
  try { await fn(); } catch (err) { return err; }
  throw new assert.AssertionError({ message: 'expected this to be refused, and it was not' });
}

// ---------------------------------------------------------------------------
// The suite, written once against a store factory.
// ---------------------------------------------------------------------------

async function runSuite(label, makeStore) {
  const s = () => makeStore([{ ...ALICE }, { ...BOB }, { ...CARLA }]);
  const device = { name: "Alice's iPhone", platform: 'ios', installId: 'install-a' };
  const opts = { verifyPassword: fakeVerify, now: T0 };
  const say = (what) => `${label}: ${what}`;

  // ── Credentials ──────────────────────────────────────────────────────────
  {
    const store = await s();
    const session = await signIn(store, { email: ALICE.email, password: PASSWORD, device }, opts);
    assert.ok(/^[A-Za-z0-9_-]{43}$/.test(session.accessToken), say('access token is 256 bits, url-safe'));
    assert.ok(/^[A-Za-z0-9_-]{43}$/.test(session.refreshToken), say('refresh token is 256 bits, url-safe'));
    assert.notStrictEqual(session.accessToken, session.refreshToken, say('the two tokens are distinct'));
    assert.strictEqual(session.expiresIn, ACCESS_TTL_SECONDS, say('access token lives 15 minutes'));
    assert.strictEqual(session.refreshExpiresIn, REFRESH_TTL_SECONDS, say('refresh token lives 30 days'));
    assert.strictEqual(session.user.id, ALICE.user_id, say('sign-in reports the web account, not a new one'));
    assert.ok(!('password_hash' in session.user) && !('passwordHash' in session.user), say('no password material in the response'));
    assert.strictEqual(session.user.emailVerifiedAt, '2026-01-01T00:00:00.000Z', say('a proven verification reports when'));

    // Stored hashed, never raw. This is the assertion that would catch a
    // regression to storing the token itself.
    const stored = await store.getToken(hashToken(session.accessToken));
    assert.ok(stored, say('the access token is found by its hash'));
    assert.strictEqual(await store.getToken(session.accessToken), null, say('the raw token is not a key'));

    const wrong = await caught(() => signIn(store, { email: ALICE.email, password: WRONG, device }, opts));
    assert.strictEqual(wrong.code, 'invalid_credentials', say('a wrong password is refused'));
    const unknown = await caught(() => signIn(store, { email: 'nobody@example.com', password: PASSWORD, device }, opts));
    assert.strictEqual(unknown.message, wrong.message, say('unknown email and wrong password answer identically'));
    assert.strictEqual(unknown.status, 401, say('both are 401'));
  }

  // ── Email verification ───────────────────────────────────────────────────
  {
    const store = await s();
    const refused = await caught(() => signIn(store, { email: CARLA.email, password: PASSWORD, device }, opts));
    assert.strictEqual(refused.code, 'email_verification_required', say('an unverified account cannot get tokens'));
    assert.strictEqual(refused.status, 403, say('and it is told why, since it proved the password'));
    assert.strictEqual(refused.extra.email, CARLA.email, say('the route is told where to send the link'));
    assert.strictEqual((await store.countLiveDevices(CARLA.user_id, T0)), 0, say('no device is created for it'));

    // Grandfathered: verified true, never actually proven. It signs in — the
    // web has always let it — but the claim is not overstated.
    const bob = await signIn(store, { email: BOB.email, password: PASSWORD, device: { ...device, installId: 'install-b' } }, opts);
    assert.strictEqual(bob.user.emailVerified, true, say('a grandfathered account signs in'));
    assert.strictEqual(bob.user.emailVerifiedAt, null, say('and is never claimed to have proven it'));
  }

  // ── Access tokens expire, and are checked every time ─────────────────────
  {
    const store = await s();
    const session = await signIn(store, { email: ALICE.email, password: PASSWORD, device }, opts);
    const live = await authenticate(store, session.accessToken, { now: at(60) });
    assert.strictEqual(live.user.user_id, ALICE.user_id, say('a fresh access token resolves'));

    const expired = await caught(() => authenticate(store, session.accessToken, { now: at(ACCESS_TTL_SECONDS + 1) }));
    assert.strictEqual(expired.code, 'token_expired', say('an expired access token is refused by code'));
    assert.strictEqual(expired.status, 401, say('expired reads as 401'));

    const nonsense = await caught(() => authenticate(store, 'not-a-token', { now: T0 }));
    assert.strictEqual(nonsense.code, 'unauthorized', say('an unknown token is unauthorized'));
    const empty = await caught(() => authenticate(store, '', { now: T0 }));
    assert.strictEqual(empty.code, 'unauthorized', say('no token is unauthorized'));
    // A refresh token is not an access token, however valid it is.
    const crossed = await caught(() => authenticate(store, session.refreshToken, { now: T0 }));
    assert.strictEqual(crossed.code, 'unauthorized', say('a refresh token cannot authenticate a request'));
  }

  // ── Rotation ─────────────────────────────────────────────────────────────
  {
    const store = await s();
    const first = await signIn(store, { email: ALICE.email, password: PASSWORD, device }, opts);
    const second = await refresh(store, { refreshToken: first.refreshToken }, { now: at(60) });
    assert.notStrictEqual(second.refreshToken, first.refreshToken, say('every refresh issues a new refresh token'));
    assert.notStrictEqual(second.accessToken, first.accessToken, say('and a new access token'));
    assert.strictEqual(second.deviceId, first.deviceId, say('the device is the same one'));
    assert.strictEqual(second.user.id, ALICE.user_id, say('refresh reports the user without a password'));

    const spent = await store.getToken(hashToken(first.refreshToken));
    assert.ok(spent && spent.used_at, say(`the presented token is marked used (${tokenFingerprint(first.refreshToken)})`));

    // The rolling window moves forward: this is what "30-day inactivity" means.
    assert.strictEqual(second.refreshExpiresIn, REFRESH_TTL_SECONDS, say('the window rolls forward on use'));

    const third = await refresh(store, { refreshToken: second.refreshToken }, { now: at(120) });
    assert.ok(third.accessToken, say('the chain continues'));
  }

  // ── Replay ───────────────────────────────────────────────────────────────
  {
    const store = await s();
    const first = await signIn(store, { email: ALICE.email, password: PASSWORD, device }, opts);
    const second = await refresh(store, { refreshToken: first.refreshToken }, { now: at(60) });

    // Past the grace window, presenting a spent token means it was captured.
    const replay = await caught(() => refresh(store, { refreshToken: first.refreshToken }, { now: at(60 + REFRESH_REUSE_GRACE_SECONDS + 1) }));
    assert.strictEqual(replay.code, 'refresh_invalid', say('a replayed refresh token is refused'));
    assert.strictEqual(replay.reuseDetected, true, say('and is recognised as a replay, not a mistake'));

    // The whole family goes, not just the token that was replayed: the live
    // successor stops working, and so does the access token in flight.
    const successor = await caught(() => refresh(store, { refreshToken: second.refreshToken }, { now: at(200) }));
    assert.strictEqual(successor.code, 'refresh_invalid', say('the successor token is revoked with the family'));
    const access = await caught(() => authenticate(store, second.accessToken, { now: at(200) }));
    assert.strictEqual(access.code, 'unauthorized', say('the access token in flight is revoked too'));
    assert.strictEqual(replay.message, successor.message, say('every refresh failure reads the same to a caller'));
  }

  // ── Asking twice inside the grace window gets the same answer twice ──────
  {
    const store = await s();
    const first = await signIn(store, { email: ALICE.email, password: PASSWORD, device }, opts);
    // The device sends two refreshes at once, or retries one whose response it
    // never saw. Both must succeed — locking a working device out is the wrong
    // failure, and it is the one a naive rotation produces.
    const a = await refresh(store, { refreshToken: first.refreshToken }, { now: at(60) });
    const b = await refresh(store, { refreshToken: first.refreshToken }, { now: at(61) });

    // And both must be the SAME answer. Issuing a second, independent chain
    // would mean a token captured in transit and replayed inside the minute
    // bought its holder a parallel session that reuse detection could never
    // see, because neither chain is ever presented twice. That is the bug a
    // security review found in the first version of this window.
    assert.strictEqual(b.refreshToken, a.refreshToken, say('a repeat inside the window repeats the answer'));
    assert.strictEqual(b.accessToken, a.accessToken, say('including the access token'));
    assert.ok(b.expiresIn < a.expiresIn, say('with the lifetime counted down, not restarted'));
    assert.strictEqual((await store.getDevice(first.deviceId)).revoked_at, null, say('no family revocation from a race'));
    const stillGood = await authenticate(store, b.accessToken, { now: at(62) });
    assert.strictEqual(stillGood.user.user_id, ALICE.user_id, say('the device is still signed in'));

    // So a replay gains nothing, and the chain it was handed is still subject
    // to detection: whichever holder rotates second is caught.
    const legitimate = await refresh(store, { refreshToken: a.refreshToken }, { now: at(200) });
    assert.ok(legitimate.accessToken, say('the real device rotates on'));
    const thief = await caught(() => refresh(store, { refreshToken: b.refreshToken }, { now: at(400) }));
    assert.strictEqual(thief.reuseDetected, true, say('and the replayer, holding the same token, is detected'));

    // Genuinely parallel, not just sequential in time: the same token
    // presented twice with no await between the calls.
    const store2 = await s();
    const start = await signIn(store2, { email: ALICE.email, password: PASSWORD, device }, opts);
    const [p, q] = await Promise.all([
      refresh(store2, { refreshToken: start.refreshToken }, { now: at(60) }),
      refresh(store2, { refreshToken: start.refreshToken }, { now: at(60) }),
    ]);
    assert.ok(p.accessToken && q.accessToken, say('two simultaneous refreshes both succeed'));
    assert.strictEqual(p.refreshToken, q.refreshToken, say('and both get the same pair, not one each'));
    assert.strictEqual((await store2.getDevice(start.deviceId)).revoked_at, null, say('and neither revokes the device'));
    // The loser of that race minted a pair before it knew it had lost. It must
    // not leave those rows behind: only the spent token and the one live pair
    // should exist.
    assert.strictEqual((await store2.listTokensForDevice(start.deviceId)).length, 4, say('the losing race leaves no orphan tokens: the spent one, its unused access token, and the one live pair'));
    assert.ok(await authenticate(store2, p.accessToken, { now: at(61) }), say('the surviving access token works'));

    // What a database thief gets from the sealed successor: nothing. The key
    // is derived from the token, which is not stored in any form.
    const store3 = await s();
    const sealed = await signIn(store3, { email: ALICE.email, password: PASSWORD, device }, opts);
    await refresh(store3, { refreshToken: sealed.refreshToken }, { now: at(60) });
    const spent = await store3.getToken(hashToken(sealed.refreshToken));
    assert.ok(spent.successor_enc, say('the successor is stored sealed'));
    assert.ok(!spent.successor_enc.includes(sealed.refreshToken), say('and the stored blob is not the token'));
    assert.strictEqual(deviceAuth.openSuccessor('a guess', spent.successor_enc), null, say('it does not open with the wrong token'));
    assert.strictEqual(deviceAuth.openSuccessor(sealed.refreshToken, spent.successor_enc.slice(0, -4) + 'AAAA'), null, say('nor when tampered with'));

    // A spent token inside the window with nothing to replay is treated as the
    // replay it looks like, rather than minting something new.
    const store4 = await s();
    const stripped = await signIn(store4, { email: ALICE.email, password: PASSWORD, device }, opts);
    await refresh(store4, { refreshToken: stripped.refreshToken }, { now: at(60) });
    await store4.recordSuccessor(hashToken(stripped.refreshToken), null);
    const nothingToRepeat = await caught(() => refresh(store4, { refreshToken: stripped.refreshToken }, { now: at(70) }));
    assert.strictEqual(nothingToRepeat.reuseDetected, true, say('an unreadable successor is a replay, not a new chain'));
  }

  // ── Expiry of the refresh window, and the absolute ceiling ───────────────
  {
    const store = await s();
    const first = await signIn(store, { email: ALICE.email, password: PASSWORD, device }, opts);
    const stale = await caught(() => refresh(store, { refreshToken: first.refreshToken }, { now: at(REFRESH_TTL_SECONDS + 1) }));
    assert.strictEqual(stale.code, 'refresh_invalid', say('an unused refresh token expires after 30 days'));

    // The ceiling: a device that refreshes every day for six months still has
    // to sign in. Rolling expiry alone would make the session permanent, which
    // is the web's mistake (SESSION_DAYS = 3650) and not one to copy.
    const store2 = await s();
    let session = await signIn(store2, { email: ALICE.email, password: PASSWORD, device }, opts);
    let clock = 0;
    const day = 24 * 60 * 60;
    for (let i = 0; i < 180; i += 1) {
      clock += day;
      if (clock >= DEVICE_ABSOLUTE_LIFETIME_SECONDS) break;
      session = await refresh(store2, { refreshToken: session.refreshToken }, { now: at(clock) });
    }
    assert.strictEqual(clock, DEVICE_ABSOLUTE_LIFETIME_SECONDS, say('the loop refreshed its way to the ceiling'));

    // Approaching the ceiling, the window is truncated rather than promising a
    // month the session will not get: the last refresh, a day short, is told so.
    assert.strictEqual(session.refreshExpiresIn, day, say('the last refresh window stops at the ceiling'));

    const ceiling = await caught(() => refresh(store2, { refreshToken: session.refreshToken }, { now: at(DEVICE_ABSOLUTE_LIFETIME_SECONDS + 1) }));
    assert.strictEqual(ceiling.code, 'refresh_invalid', say('a device session ends at six months however often it refreshed'));
    assert.ok((await store2.getDevice(session.deviceId)).revoked_at, say('and the device is marked revoked'));
  }

  // ── Per-device sessions, and independent revocation ──────────────────────
  {
    const store = await s();
    const phone = await signIn(store, { email: ALICE.email, password: PASSWORD, device: { name: 'iPhone', platform: 'ios', installId: 'phone' } }, opts);
    const tablet = await signIn(store, { email: ALICE.email, password: PASSWORD, device: { name: 'iPad', platform: 'ios', installId: 'tablet' } }, opts);
    assert.notStrictEqual(phone.deviceId, tablet.deviceId, say('two installs are two devices'));

    const devices = await listDevices(store, ALICE.user_id, phone.deviceId, { now: T0 });
    assert.strictEqual(devices.length, 2, say('both devices are listed'));
    assert.strictEqual(devices.filter((d) => d.current).length, 1, say('exactly one is marked current'));
    assert.ok(devices.every((d) => !('install_id' in d) && !('token_hash' in d)), say('the list carries no credential material'));

    await revokeDevice(store, ALICE.user_id, tablet.deviceId, { now: at(10) });
    const gone = await caught(() => authenticate(store, tablet.accessToken, { now: at(11) }));
    assert.strictEqual(gone.code, 'unauthorized', say('revoking the tablet stops it immediately'));
    const survives = await authenticate(store, phone.accessToken, { now: at(11) });
    assert.strictEqual(survives.device.id, phone.deviceId, say('the phone is unaffected'));
    const tabletRefresh = await caught(() => refresh(store, { refreshToken: tablet.refreshToken }, { now: at(11) }));
    assert.strictEqual(tabletRefresh.code, 'refresh_invalid', say('and the tablet cannot refresh its way back'));

    // Another account's device id reads as "no such device" rather than a 403,
    // so the endpoint cannot be used to find out that an id exists.
    const bobDevice = await signIn(store, { email: BOB.email, password: PASSWORD, device: { name: 'Bob phone', platform: 'android', installId: 'bob-1' } }, opts);
    const forbidden = await caught(() => revokeDevice(store, ALICE.user_id, bobDevice.deviceId, { now: at(12) }));
    assert.strictEqual(forbidden.status, 404, say("another account's device is not revocable"));
    assert.strictEqual(forbidden.code, 'device_not_found', say('and is reported as absent, not as forbidden'));
    const bobStillIn = await authenticate(store, bobDevice.accessToken, { now: at(13) });
    assert.strictEqual(bobStillIn.user.user_id, BOB.user_id, say("and Bob's device still works"));

    const bobList = await listDevices(store, BOB.user_id, bobDevice.deviceId, { now: at(13) });
    assert.deepStrictEqual(bobList.map((d) => d.id), [bobDevice.deviceId], say('a device list is scoped to its own account'));

    // Belt and braces, and the reason it is worth having: revocation deletes
    // the device's tokens, so the deletion alone would pass every assertion
    // above. A token that outlived its device anyway — written by hand, kept
    // for audit by some later change — must still be refused because the
    // device is revoked. Mutating away the revoked_at check must fail a test,
    // not just make the code look redundant.
    const orphan = deviceAuth.mintToken();
    await store.insertToken({ tokenHash: hashToken(orphan), deviceId: tablet.deviceId, kind: 'access', expiresAt: at(3600), createdAt: at(14) });
    const orphaned = await caught(() => authenticate(store, orphan, { now: at(15) }));
    assert.strictEqual(orphaned.code, 'unauthorized', say('a live token on a revoked device is refused'));

    // Same for the absolute ceiling: a token minted inside the window is no
    // use once the device itself is too old.
    const aged = deviceAuth.mintToken();
    await store.insertToken({ tokenHash: hashToken(aged), deviceId: phone.deviceId, kind: 'access', expiresAt: at(DEVICE_ABSOLUTE_LIFETIME_SECONDS + 3600), createdAt: at(16) });
    const tooOld = await caught(() => authenticate(store, aged, { now: at(DEVICE_ABSOLUTE_LIFETIME_SECONDS + 1) }));
    assert.strictEqual(tooOld.code, 'unauthorized', say('a token outliving the six-month ceiling is refused'));
  }

  // ── Signing in again on a known device starts a clean chain ──────────────
  {
    const store = await s();
    const first = await signIn(store, { email: ALICE.email, password: PASSWORD, device }, opts);
    const again = await signIn(store, { email: ALICE.email, password: PASSWORD, device }, { ...opts, now: at(30) });
    assert.strictEqual(again.deviceId, first.deviceId, say('the same install is the same device row'));
    const old = await caught(() => authenticate(store, first.accessToken, { now: at(31) }));
    assert.strictEqual(old.code, 'unauthorized', say('the previous session stops working'));
    assert.strictEqual((await listDevices(store, ALICE.user_id, again.deviceId, { now: at(31) })).length, 1, say('and no duplicate device appears'));
  }

  // ── Sign-out and credential change ───────────────────────────────────────
  {
    const store = await s();
    const session = await signIn(store, { email: ALICE.email, password: PASSWORD, device }, opts);
    await signOut(store, { deviceId: session.deviceId }, { now: at(5) });
    const after = await caught(() => authenticate(store, session.accessToken, { now: at(6) }));
    assert.strictEqual(after.code, 'unauthorized', say('sign-out ends the session at once'));
    assert.deepStrictEqual(await signOut(store, { deviceId: session.deviceId }, { now: at(7) }), { ok: true }, say('sign-out is idempotent'));
    assert.deepStrictEqual(await signOut(store, { deviceId: null }, { now: at(7) }), { ok: true }, say('sign-out without a device is still ok'));

    const store2 = await s();
    const phone = await signIn(store2, { email: ALICE.email, password: PASSWORD, device: { name: 'iPhone', platform: 'ios', installId: 'p' } }, opts);
    const tablet = await signIn(store2, { email: ALICE.email, password: PASSWORD, device: { name: 'iPad', platform: 'ios', installId: 't' } }, opts);
    const bob = await signIn(store2, { email: BOB.email, password: PASSWORD, device: { name: 'B', platform: 'android', installId: 'b' } }, opts);
    const revoked = await revokeAllDevices(store2, ALICE.user_id, { now: at(20) });
    assert.strictEqual(revoked, 2, say('a credential change revokes every device of that account'));
    for (const [name, s2] of [['phone', phone], ['tablet', tablet]]) {
      const err = await caught(() => authenticate(store2, s2.accessToken, { now: at(21) }));
      assert.strictEqual(err.code, 'unauthorized', say(`${name} is signed out by the credential change`));
    }
    const unaffected = await authenticate(store2, bob.accessToken, { now: at(21) });
    assert.strictEqual(unaffected.user.user_id, BOB.user_id, say("another account's devices are untouched"));
  }

  // ── The device ceiling ───────────────────────────────────────────────────
  {
    const store = await s();
    for (let i = 0; i < MAX_DEVICES_PER_USER; i += 1) {
      await signIn(store, { email: ALICE.email, password: PASSWORD, device: { name: `d${i}`, platform: 'ios', installId: `install-${i}` } }, opts);
    }
    const over = await caught(() => signIn(store, { email: ALICE.email, password: PASSWORD, device: { name: 'one too many', platform: 'ios', installId: 'extra' } }, opts));
    assert.strictEqual(over.code, 'device_limit_reached', say('an account cannot accumulate unbounded devices'));
    assert.strictEqual(over.status, 409, say('and is told so plainly'));
  }

  // ── Input that is not what the client is supposed to send ────────────────
  {
    const store = await s();
    const long = await signIn(store, { email: ALICE.email, password: PASSWORD, device: { name: 'x'.repeat(5000), platform: '<script>', installId: 'y'.repeat(5000) } }, opts);
    const listed = (await listDevices(store, ALICE.user_id, long.deviceId, { now: T0 }))[0];
    assert.ok(listed.name.length <= 120, say('a device name is bounded'));
    assert.strictEqual(listed.platform, 'unknown', say('an unrecognised platform is not stored verbatim'));

    for (const bad of [null, undefined, 0, {}, []]) {
      const err = await caught(() => refresh(store, { refreshToken: bad }, { now: T0 }));
      assert.strictEqual(err.code, 'refresh_invalid', say(`refresh refuses ${JSON.stringify(bad)}`));
    }
    const noDevice = await signIn(store, { email: ALICE.email, password: PASSWORD }, { ...opts, now: at(1) });
    assert.ok(noDevice.accessToken, say('a sign-in with no device block still works'));
    assert.strictEqual(noDevice.device.name, 'Unknown device', say('and is named honestly'));
  }

  // ── Entropy ──────────────────────────────────────────────────────────────
  {
    const store = await s();
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      const session = await signIn(store, { email: ALICE.email, password: PASSWORD, device }, { ...opts, now: at(i) });
      seen.add(session.accessToken);
      seen.add(session.refreshToken);
    }
    assert.strictEqual(seen.size, 400, say('400 minted tokens, 400 distinct values'));
  }

  console.log(`  ${label}: ok`);
}

// ---------------------------------------------------------------------------

async function main() {
  await runSuite('memory store', async (users) => createMemoryStore(users));

  // The same assertions against real SQL, when a database is offered. Never
  // against production: the script refuses anything that is not plainly a test
  // database, and it drops its own tables on the way out.
  const url = process.env.DEVICE_AUTH_TEST_DATABASE_URL;
  if (!url) {
    console.log('  postgres store: skipped (set DEVICE_AUTH_TEST_DATABASE_URL to an isolated test database to include it)');
    process.exitCode = 0;
  console.log('device-auth-test: ok');
    return;
  }
  if (!/test|localhost|127\.0\.0\.1/i.test(url)) {
    throw new Error('DEVICE_AUTH_TEST_DATABASE_URL does not look like a test database; refusing to touch it');
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
  const schema = `device_auth_test_${crypto.randomBytes(4).toString('hex')}`;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`SET search_path TO ${schema}`);
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await pool.query('CREATE TABLE profiles (user_id text PRIMARY KEY, email text UNIQUE, display_name text, role text, password_hash text, email_verified boolean, email_verified_at timestamptz)');
    await ensureSchema(pool);
    await runSuite('postgres store', async (users) => {
      await pool.query('DELETE FROM device_tokens');
      await pool.query('DELETE FROM device_sessions');
      await pool.query('DELETE FROM profiles');
      for (const u of users) {
        await pool.query('INSERT INTO profiles VALUES($1,$2,$3,$4,$5,$6,$7)', [u.user_id, u.email, u.display_name, u.role, u.password_hash, u.email_verified, u.email_verified_at]);
      }
      return createPgStore(pool);
    });
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await pool.end().catch(() => {});
  }
  process.exitCode = 0;
  console.log('device-auth-test: ok');
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
