// The real server, the real routes, a real PostgreSQL database.
//
// scripts/device-auth-test.js proves the lifecycle and runs in CI with no
// database at all. This one proves the parts that only a database can: that
// the bootstrap creates what the code expects and can be run twice, that
// household and recipe authorization reaches the same answer through a bearer
// token as through a cookie, that a credential change is genuinely
// transactional, and that expiry and replay behave against stored rows rather
// than against an in-memory map.
//
// It is opt-in and destructive to its own database only: it creates one, uses
// it, and drops it. Set DEVICE_AUTH_TEST_DATABASE_URL to an isolated instance
// — for example a throwaway container:
//
//   docker run -d --rm --name recipebox-auth-test -e POSTGRES_PASSWORD=pw \
//     -e POSTGRES_DB=recipebox_devauth_test -p 55432:5432 postgres:16-alpine
//
// Never a production URL. The guard below refuses anything that does not look
// like a test database, and the script connects to the admin database only to
// create and drop its own.

const assert = require('assert');
const crypto = require('crypto');

process.exitCode = 1;

const ADMIN_URL = process.env.DEVICE_AUTH_TEST_DATABASE_URL || '';
if (!ADMIN_URL) {
  console.log('device-auth-db-test: skipped (set DEVICE_AUTH_TEST_DATABASE_URL to an isolated test database)');
  process.exitCode = 0;
  return;
}
if (!/test|localhost|127\.0\.0\.1/i.test(ADMIN_URL) || /neon\.tech/i.test(ADMIN_URL)) {
  console.error('DEVICE_AUTH_TEST_DATABASE_URL does not look like an isolated test database; refusing to touch it');
  process.exit(1);
}

const PASSWORD = 'recipebox-test-password';
const DB_NAME = 'rb_devauth_' + crypto.randomBytes(4).toString('hex');

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

function sessionCookie(setCookie) {
  const match = /rb_session=([^;]+)/.exec(setCookie || '');
  return match ? 'rb_session=' + match[1] : '';
}

const device = (installId, name) => ({ name: name || 'DB test device', platform: 'ios', installId });

async function main() {
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: ADMIN_URL });
  await admin.query('CREATE DATABASE ' + DB_NAME);

  // The server reads DATABASE_URL lazily, so it has to be set before the first
  // request — but the module is required here, against the test database only.
  process.env.DATABASE_URL = urlForDatabase(ADMIN_URL, DB_NAME);
  const app = require('../server');
  const deviceAuth = require('../lib/device-auth');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;

  try {
    await run(app, deviceAuth, pool);
    process.exitCode = 0;
    console.log('device-auth-db-test: ok');
  } finally {
    server.close();
    await pool.end().catch(() => {});
    // The server holds its own pool; close it so the database can be dropped.
    await app._test.closePool().catch(() => {});
    await admin.query('DROP DATABASE IF EXISTS ' + DB_NAME + ' WITH (FORCE)').catch(async () => {
      await admin.query('DROP DATABASE IF EXISTS ' + DB_NAME).catch(() => {});
    });
    await admin.end().catch(() => {});
  }
}

async function run(app, deviceAuth, pool) {
  // ── Schema ───────────────────────────────────────────────────────────────
  // The bootstrap runs on the first getPool(), not at startup — /api/health
  // only reports whether the environment names a database, so it proves
  // nothing about the schema. A request that actually touches the pool is what
  // builds it, and if the new statements were wrong nothing below would work.
  const health = await call('GET', '/api/health');
  assert.strictEqual(health.json.database, true, 'the server is pointed at a database');
  const firstTouch = await call('GET', '/api/auth/session');
  assert.strictEqual(firstTouch.status, 200, 'the first request that uses the pool runs the bootstrap: ' + firstTouch.text.slice(0, 200));

  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('device_sessions','device_tokens') ORDER BY table_name"
  );
  assert.deepStrictEqual(tables.rows.map((r) => r.table_name), ['device_sessions', 'device_tokens'], 'both device tables were created by the bootstrap');

  const columns = await pool.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='device_tokens' ORDER BY column_name"
  );
  const columnNames = columns.rows.map((r) => r.column_name);
  for (const expected of ['created_at', 'device_id', 'expires_at', 'kind', 'successor_enc', 'token_hash', 'used_at']) {
    assert.ok(columnNames.includes(expected), 'device_tokens has ' + expected);
  }

  const indexes = await pool.query("SELECT indexname FROM pg_indexes WHERE tablename='device_sessions'");
  assert.ok(indexes.rows.some((r) => r.indexname === 'device_sessions_install_idx'), 'the partial unique index on (user_id, install_id) exists');

  // Migrations are run on every cold start, so running them twice must be a
  // no-op rather than an error. This is the assertion that would catch a
  // CREATE without IF NOT EXISTS.
  await deviceAuth.ensureSchema(pool);
  await deviceAuth.ensureSchema(pool);

  // The foreign key is real, not decorative: a token cannot outlive its device.
  await assert.rejects(
    () => pool.query("INSERT INTO device_tokens(token_hash, device_id, kind, expires_at) VALUES('x','11111111-1111-4111-8111-111111111111','access', now())"),
    (err) => err.code === '23503',
    'device_tokens.device_id is enforced by a foreign key'
  );

  // ── Accounts: verification is enforced where the data supports it ────────
  const newEmail = 'new-' + crypto.randomBytes(3).toString('hex') + '@example.test';
  const signup = await call('POST', '/api/auth/signup', { body: { email: newEmail, password: PASSWORD, displayName: 'New Cook' } });
  assert.strictEqual(signup.status, 200, 'the web signup route still works: ' + signup.text.slice(0, 160));
  assert.strictEqual(signup.json.user.emailVerified, false, 'a new account starts unverified');
  const newCookie = sessionCookie(signup.setCookie);
  assert.ok(newCookie, 'and gets a web session cookie');

  const refusedNative = await call('POST', '/api/v1/auth/signin', { body: { email: newEmail, password: PASSWORD, device: device('new-1') } });
  assert.strictEqual(refusedNative.status, 403, 'an unverified account cannot get a device token');
  assert.strictEqual(refusedNative.json.code, 'email_verification_required', 'and is told why');
  const noDevices = await pool.query('SELECT count(*)::int AS n FROM device_sessions');
  assert.strictEqual(noDevices.rows[0].n, 0, 'and no device row is created for it');

  // The web session that account already had is untouched — the policy is a
  // native one, and it must not evict anyone from the web app.
  const stillWeb = await call('GET', '/api/auth/session', { cookie: newCookie });
  assert.strictEqual(stillWeb.json.user.email, newEmail, 'the unverified account is still signed in on the web');

  // Verify it the way the product does: the hashed single-use token the web
  // route consumes. The token is minted here rather than emailed, because
  // email delivery needs a production key.
  const verifyToken = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    "INSERT INTO email_verification_tokens(token_hash, user_id, expires_at) VALUES($1, $2, now() + interval '1 hour')",
    [app._test.hashToken(verifyToken), signup.json.user.id]
  );
  const verified = await call('POST', '/api/auth/verify-email', { body: { token: verifyToken } });
  assert.strictEqual(verified.status, 200, 'the verification token is accepted: ' + verified.text.slice(0, 120));
  const reused = await call('POST', '/api/auth/verify-email', { body: { token: verifyToken } });
  assert.strictEqual(reused.status, 400, 'and is single-use');

  const nowNative = await call('POST', '/api/v1/auth/signin', { body: { email: newEmail, password: PASSWORD, device: device('new-1') } });
  assert.strictEqual(nowNative.status, 200, 'a verified account signs in natively');
  assert.ok(nowNative.json.user.emailVerifiedAt, 'and reports when it was proven');

  // ── Grandfathered accounts ───────────────────────────────────────────────
  // Rows that predate verification: the column says true, nobody proved it.
  const grandEmail = 'grand-' + crypto.randomBytes(3).toString('hex') + '@example.test';
  const grandId = crypto.randomUUID();
  await pool.query(
    "INSERT INTO profiles(user_id, email, display_name, role, password_hash, email_verified, email_verified_at) VALUES($1,$2,'Old Cook','user',$3,true,NULL)",
    [grandId, grandEmail, app._test.hashPassword(PASSWORD)]
  );
  const grandSignin = await call('POST', '/api/v1/auth/signin', { body: { email: grandEmail, password: PASSWORD, device: device('grand-1') } });
  assert.strictEqual(grandSignin.status, 200, 'a grandfathered account signs in: ' + grandSignin.text.slice(0, 160));
  assert.strictEqual(grandSignin.json.user.emailVerified, true, 'it reads as verified');
  assert.strictEqual(grandSignin.json.user.emailVerifiedAt, null, 'and is never claimed to have proven it');

  // ── Household authorization, through both transports ─────────────────────
  const ownerToken = grandSignin.json.accessToken;
  const emptyHousehold = await call('GET', '/api/v1/household', { token: ownerToken });
  assert.deepStrictEqual(emptyHousehold.json, { household: null }, 'no household yet');

  // Create it on the web, with a cookie, and read it natively with a token.
  const webSignin = await call('POST', '/api/auth/signin', { body: { email: grandEmail, password: PASSWORD } });
  const grandCookie = sessionCookie(webSignin.setCookie);
  const created = await call('POST', '/api/household/create', { cookie: grandCookie, body: { name: 'The Test Kitchen' } });
  assert.strictEqual(created.status, 200, 'the household is created on the web: ' + created.text.slice(0, 160));

  const nativeHousehold = await call('GET', '/api/v1/household', { token: ownerToken });
  const webHousehold = await call('GET', '/api/household', { cookie: grandCookie });
  assert.strictEqual(nativeHousehold.status, 200, 'the device sees the household');
  assert.deepStrictEqual(nativeHousehold.json, webHousehold.json, 'and sees exactly what the browser sees');
  assert.strictEqual(nativeHousehold.json.role, 'owner', 'with the same role');

  // A second account reaches none of it. This is the assertion that would
  // catch an authorization path that only checks "is signed in".
  const otherSignin = await call('POST', '/api/v1/auth/signin', { body: { email: newEmail, password: PASSWORD, device: device('new-1') } });
  const otherHousehold = await call('GET', '/api/v1/household', { token: otherSignin.json.accessToken });
  assert.deepStrictEqual(otherHousehold.json, { household: null }, "another account sees nothing of someone else's household");

  // And neither transport honours the other's credential.
  const cookieAsBearer = await call('GET', '/api/v1/me', { token: grandCookie.replace('rb_session=', '') });
  assert.strictEqual(cookieAsBearer.status, 401, 'a live session cookie is not a bearer token');
  const bearerAsCookie = await call('GET', '/api/household', { cookie: 'rb_session=' + ownerToken });
  assert.strictEqual(bearerAsCookie.status, 401, 'a live device token is not a session cookie');

  // ── Concurrent refresh, over two real connections ────────────────────────
  const [a, b] = await Promise.all([
    call('POST', '/api/v1/auth/refresh', { body: { refreshToken: grandSignin.json.refreshToken } }),
    call('POST', '/api/v1/auth/refresh', { body: { refreshToken: grandSignin.json.refreshToken } }),
  ]);
  assert.strictEqual(a.status, 200, 'the first concurrent refresh succeeds');
  assert.strictEqual(b.status, 200, 'and so does the second');
  assert.strictEqual(a.json.refreshToken, b.json.refreshToken, 'both get the same pair, decided by one UPDATE');
  const notRevoked = await pool.query('SELECT revoked_at FROM device_sessions WHERE id=$1', [grandSignin.json.deviceId]);
  assert.strictEqual(notRevoked.rows[0].revoked_at, null, 'and the race does not revoke the device');

  const liveAfterRace = await call('GET', '/api/v1/me', { token: a.json.accessToken });
  assert.strictEqual(liveAfterRace.status, 200, 'the pair they share works');

  // ── Replay past the window, against stored rows ──────────────────────────
  // The grace window is a real minute, so the row is aged rather than waited
  // out: this is the same state the database would be in after one.
  await pool.query("UPDATE device_tokens SET used_at = now() - interval '10 minutes' WHERE token_hash=$1", [deviceAuth.hashToken(grandSignin.json.refreshToken)]);
  const replay = await call('POST', '/api/v1/auth/refresh', { body: { refreshToken: grandSignin.json.refreshToken } });
  assert.strictEqual(replay.status, 401, 'a replay outside the window is refused');
  assert.strictEqual(replay.json.code, 'refresh_invalid', 'with the one refresh failure code');

  const revoked = await pool.query('SELECT revoked_at FROM device_sessions WHERE id=$1', [grandSignin.json.deviceId]);
  assert.ok(revoked.rows[0].revoked_at, 'and the whole device chain is revoked');
  const tokensLeft = await pool.query('SELECT count(*)::int AS n FROM device_tokens WHERE device_id=$1', [grandSignin.json.deviceId]);
  assert.strictEqual(tokensLeft.rows[0].n, 0, 'its tokens are deleted, not merely marked');
  const deadAccess = await call('GET', '/api/v1/me', { token: a.json.accessToken });
  assert.strictEqual(deadAccess.status, 401, 'the access token in flight stops working at once');

  // The web session of the same person is untouched by a device revocation.
  const webSurvives = await call('GET', '/api/auth/session', { cookie: grandCookie });
  assert.strictEqual(webSurvives.json.user.email, grandEmail, 'revoking a device does not sign the browser out');

  // ── Several devices, revoked independently ───────────────────────────────
  const phone = await call('POST', '/api/v1/auth/signin', { body: { email: grandEmail, password: PASSWORD, device: device('phone', 'Phone') } });
  const tablet = await call('POST', '/api/v1/auth/signin', { body: { email: grandEmail, password: PASSWORD, device: device('tablet', 'Tablet') } });
  const list = await call('GET', '/api/v1/auth/devices', { token: phone.json.accessToken });
  assert.strictEqual(list.json.devices.length, 2, 'both devices are listed');

  const revokeOther = await call('DELETE', '/api/v1/auth/devices/' + tablet.json.deviceId, { token: phone.json.accessToken });
  assert.strictEqual(revokeOther.status, 200, 'one device revokes another');
  assert.strictEqual((await call('GET', '/api/v1/me', { token: tablet.json.accessToken })).status, 401, 'the revoked one stops at once');
  assert.strictEqual((await call('GET', '/api/v1/me', { token: phone.json.accessToken })).status, 200, 'the other is unaffected');

  // Someone else's device id is a 404, not a 403 — no id oracle.
  const foreign = await call('DELETE', '/api/v1/auth/devices/' + otherSignin.json.deviceId, { token: phone.json.accessToken });
  assert.strictEqual(foreign.status, 404, "another account's device cannot be revoked");
  assert.strictEqual((await call('GET', '/api/v1/me', { token: otherSignin.json.accessToken })).status, 200, 'and is untouched');

  // ── The absolute ceiling, against a stored timestamp ─────────────────────
  await pool.query("UPDATE device_sessions SET created_at = now() - interval '181 days' WHERE id=$1", [phone.json.deviceId]);
  const tooOld = await call('POST', '/api/v1/auth/refresh', { body: { refreshToken: phone.json.refreshToken } });
  assert.strictEqual(tooOld.status, 401, 'a device past six months cannot refresh');
  const ceilingRevoked = await pool.query('SELECT revoked_at FROM device_sessions WHERE id=$1', [phone.json.deviceId]);
  assert.ok(ceilingRevoked.rows[0].revoked_at, 'and is retired');

  // Signing in again on that same install must not collide with the partial
  // unique index — the failure the review predicted for six months in.
  const afterCeiling = await call('POST', '/api/v1/auth/signin', { body: { email: grandEmail, password: PASSWORD, device: device('phone', 'Phone') } });
  assert.strictEqual(afterCeiling.status, 200, 'the same install signs in again after its ceiling: ' + afterCeiling.text.slice(0, 160));
  assert.notStrictEqual(afterCeiling.json.deviceId, phone.json.deviceId, 'as a new device row');

  // ── Sign-out ─────────────────────────────────────────────────────────────
  const out = await call('POST', '/api/v1/auth/signout', { token: afterCeiling.json.accessToken });
  assert.strictEqual(out.status, 200, 'sign-out answers 200');
  assert.strictEqual((await call('GET', '/api/v1/me', { token: afterCeiling.json.accessToken })).status, 401, 'and ends the session');
  const outRows = await pool.query('SELECT revoked_at FROM device_sessions WHERE id=$1', [afterCeiling.json.deviceId]);
  assert.ok(outRows.rows[0].revoked_at, 'the row is revoked, not deleted — the device list keeps its history');

  // ── A credential change is transactional ─────────────────────────────────
  const txEmail = 'tx-' + crypto.randomBytes(3).toString('hex') + '@example.test';
  const txId = crypto.randomUUID();
  await pool.query(
    "INSERT INTO profiles(user_id, email, display_name, role, password_hash, email_verified, email_verified_at) VALUES($1,$2,'Tx Cook','user',$3,true,now())",
    [txId, txEmail, app._test.hashPassword(PASSWORD)]
  );
  const txWeb = await call('POST', '/api/auth/signin', { body: { email: txEmail, password: PASSWORD } });
  const txCookie = sessionCookie(txWeb.setCookie);
  const txDevice = await call('POST', '/api/v1/auth/signin', { body: { email: txEmail, password: PASSWORD, device: device('tx-1') } });
  assert.strictEqual(txDevice.status, 200, 'the transactional account has a device');

  // Break a table the transaction writes, so the statement after the password
  // update fails. Everything in the block must roll back together.
  await pool.query('ALTER TABLE password_reset_tokens RENAME TO password_reset_tokens_hidden');
  let failed;
  try {
    failed = await call('POST', '/api/auth/change-password', { cookie: txCookie, body: { currentPassword: PASSWORD, newPassword: 'a-different-password' } });
  } finally {
    await pool.query('ALTER TABLE password_reset_tokens_hidden RENAME TO password_reset_tokens');
  }
  assert.strictEqual(failed.status, 500, 'the change fails when a statement inside the transaction fails');

  const unchanged = await pool.query('SELECT password_hash FROM profiles WHERE user_id=$1', [txId]);
  assert.ok(app._test.verifyPassword(PASSWORD, unchanged.rows[0].password_hash), 'the password is unchanged — the update rolled back');
  const deviceSurvived = await call('GET', '/api/v1/me', { token: txDevice.json.accessToken });
  assert.strictEqual(deviceSurvived.status, 200, 'and the device revocation rolled back with it');

  // The success path: the same change, with the table where it belongs.
  const changed = await call('POST', '/api/auth/change-password', { cookie: txCookie, body: { currentPassword: PASSWORD, newPassword: 'a-different-password' } });
  assert.strictEqual(changed.status, 200, 'the change succeeds now: ' + changed.text.slice(0, 160));
  const deviceGone = await call('GET', '/api/v1/me', { token: txDevice.json.accessToken });
  assert.strictEqual(deviceGone.status, 401, 'changing a password signs every device out');
  const refreshGone = await call('POST', '/api/v1/auth/refresh', { body: { refreshToken: txDevice.json.refreshToken } });
  assert.strictEqual(refreshGone.status, 401, 'including the refresh token');
  const webKept = await call('GET', '/api/auth/session', { cookie: txCookie });
  assert.strictEqual(webKept.json.user.email, txEmail, 'while the browser that made the change stays signed in');

  // ── A transaction that is actually one, under concurrency ───────────────
  //
  // The rollback above passes either way: one caller at a time, a pool happens
  // to hand back the same connection every time, so `pool.query('BEGIN')` looks
  // transactional. Two callers is where it stops. Measured here against
  // PostgreSQL 16 before the fix: two callers each ran BEGIN / INSERT /
  // ROLLBACK through the pool and one row survived both rollbacks, because the
  // BEGIN and the INSERT were on different backends. withTransaction checks a
  // client out, which is what `upsertUserRecipe` has always done.
  await pool.query('CREATE TABLE IF NOT EXISTS tx_probe(id int primary key, backend int)');
  await pool.query('DELETE FROM tx_probe');

  async function abortingCaller(id) {
    const backends = [];
    try {
      await app._test.withTransaction(pool, async (tx) => {
        backends.push((await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        await tx.query('INSERT INTO tx_probe VALUES($1, $2)', [id, backends[0]]);
        await new Promise((resolve) => setTimeout(resolve, 15));
        backends.push((await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        throw new Error('deliberate failure inside the transaction');
      });
    } catch (err) {
      assert.strictEqual(err.message, 'deliberate failure inside the transaction', 'the original error survives the rollback');
    }
    return backends;
  }

  const [first, second] = await Promise.all([abortingCaller(1), abortingCaller(2)]);
  assert.strictEqual(first[0], first[1], 'a transaction keeps one backend from start to finish');
  assert.strictEqual(second[0], second[1], 'and so does the one running beside it');
  assert.notStrictEqual(first[0], second[0], 'while the two use different backends, so they really did overlap');
  const survivors = await pool.query('SELECT count(*)::int AS n FROM tx_probe');
  assert.strictEqual(survivors.rows[0].n, 0, 'nothing survives two concurrent rollbacks');

  // And the committing case still commits.
  await app._test.withTransaction(pool, async (tx) => {
    await tx.query('INSERT INTO tx_probe VALUES(3, 0)');
  });
  const committed = await pool.query('SELECT count(*)::int AS n FROM tx_probe');
  assert.strictEqual(committed.rows[0].n, 1, 'a transaction that finishes is kept');
  await pool.query('DROP TABLE tx_probe');

  // ── Rate limiting is backed by the database here, not the in-memory map ──
  const rlEmail = 'rl-' + crypto.randomBytes(3).toString('hex') + '@example.test';
  let limited = null;
  for (let i = 0; i < 25; i += 1) {
    const attempt = await call('POST', '/api/v1/auth/signin', { body: { email: rlEmail, password: 'wrong', device: device('rl-' + i) } });
    if (attempt.status === 429) { limited = attempt; break; }
  }
  assert.ok(limited, 'the shared sign-in budget runs out');
  assert.strictEqual(limited.json.code, 'rate_limited', 'with a code the client can act on');
  const counters = await pool.query("SELECT count(*)::int AS n FROM rate_limit_counters WHERE bucket LIKE 'auth:%'");
  assert.ok(counters.rows[0].n > 0, 'and it is counted in the database, so it survives a cold start');
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
