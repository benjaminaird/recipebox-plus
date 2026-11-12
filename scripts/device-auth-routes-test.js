// /api/v1 over HTTP: the real Express app, the real router, the real lifecycle.
// Only the store is swapped for the in-memory one, so this runs with no
// database and no network and is what CI exercises.
//
// What the suite is for: the lifecycle suite proves the rules; this proves the
// wiring — status codes, stable error codes, header parsing, which surface
// honours which credential, and that a published client is never handed the
// SPA's HTML where it expected JSON.

process.env.DATABASE_URL = '';

const assert = require('assert');
const crypto = require('crypto');
const app = require('../server');
const deviceAuth = require('../lib/device-auth');

const PASSWORD = 'correct horse battery';

// The server verifies with its own scrypt, so the fixtures carry real hashes in
// the format signup stores — not a stand-in the test agrees with itself about.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(String(password), salt, 32).toString('hex');
}

const users = [
  { user_id: 'user-alice', email: 'alice@example.com', display_name: 'Alice', role: 'user', password_hash: hashPassword(PASSWORD), email_verified: true, email_verified_at: new Date('2026-01-01T00:00:00Z') },
  { user_id: 'user-carla', email: 'carla@example.com', display_name: 'Carla', role: 'user', password_hash: hashPassword(PASSWORD), email_verified: false, email_verified_at: null },
];

const store = deviceAuth.createMemoryStore(users);

// A suite that stops halfway must not pass. An await on a promise that never
// settles empties the event loop, and node then exits 0 with most of the file
// unrun -- so the exit code starts as a failure and is cleared only by the line
// that announces success at the very end.
process.exitCode = 1;
app._test.useDeviceStore(store);

let base = '';
async function call(method, path, options) {
  const o = options || {};
  const headers = Object.assign(
    o.body ? { 'Content-Type': 'application/json' } : {},
    o.token ? { Authorization: 'Bearer ' + o.token } : {},
    o.cookie ? { Cookie: 'rb_session=' + o.cookie } : {},
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
  try { json = JSON.parse(text); } catch { /* not JSON: the assertion will say so */ }
  return { status: res.status, json, text, contentType: res.headers.get('content-type') || '' };
}

function signinBody(over) {
  return Object.assign({
    email: 'alice@example.com',
    password: PASSWORD,
    device: { name: 'Test iPhone', platform: 'ios', installId: 'route-test' },
  }, over || {});
}

async function run() {
  // ── Sign in ──────────────────────────────────────────────────────────────
  const signin = await call('POST', '/api/v1/auth/signin', { body: signinBody() });
  assert.strictEqual(signin.status, 200, 'sign-in succeeds (got ' + signin.status + ' ' + signin.text.slice(0, 160) + ')');
  assert.ok(signin.contentType.includes('application/json'), 'and answers JSON');
  const session = signin.json;
  assert.ok(session.accessToken && session.refreshToken, 'a pair is issued');
  assert.strictEqual(session.expiresIn, deviceAuth.ACCESS_TTL_SECONDS, 'the access lifetime is reported in seconds');
  assert.strictEqual(session.user.id, 'user-alice', 'the web account is who signed in');
  assert.ok(!JSON.stringify(session).includes('scrypt$'), 'no password material reaches the client');
  assert.ok(!JSON.stringify(session).includes('token_hash'), 'no token hash reaches the client');

  const wrong = await call('POST', '/api/v1/auth/signin', { body: signinBody({ password: 'nope' }) });
  assert.strictEqual(wrong.status, 401, 'a wrong password is 401');
  assert.strictEqual(wrong.json.code, 'invalid_credentials', 'with a stable code');
  const unknown = await call('POST', '/api/v1/auth/signin', { body: signinBody({ email: 'nobody@example.com', password: 'nope' }) });
  assert.strictEqual(unknown.json.code, wrong.json.code, 'an unknown account answers exactly as a wrong password does');
  assert.strictEqual(unknown.json.message, wrong.json.message, 'including the message');

  const unverified = await call('POST', '/api/v1/auth/signin', { body: signinBody({ email: 'carla@example.com' }) });
  assert.strictEqual(unverified.status, 403, 'an unverified account is refused');
  assert.strictEqual(unverified.json.code, 'email_verification_required', 'and told what to do about it');
  assert.strictEqual(unverified.json.verificationEmailSent, false, 'no email is claimed when none can be sent');
  assert.ok(!unverified.json.accessToken, 'and no token is issued');

  // ── Using the token ──────────────────────────────────────────────────────
  const me = await call('GET', '/api/v1/me', { token: session.accessToken });
  assert.strictEqual(me.status, 200, 'the access token reaches /me');
  assert.strictEqual(me.json.user.id, 'user-alice', 'as the right person');
  assert.strictEqual(me.json.user.emailVerifiedAt, '2026-01-01T00:00:00.000Z', 'verification is reported with its date');
  assert.ok(!('password_hash' in me.json.user), '/me never carries the password hash');

  const refusals = [
    ['no header', {}],
    ['empty bearer', { Authorization: 'Bearer ' }],
    ['wrong scheme', { Authorization: 'Basic ' + session.accessToken }],
    ['token without a scheme', { Authorization: session.accessToken }],
    ['unknown token', { Authorization: 'Bearer ' + crypto.randomBytes(32).toString('base64url') }],
  ];
  for (const entry of refusals) {
    const res = await call('GET', '/api/v1/me', { headers: entry[1] });
    assert.strictEqual(res.status, 401, entry[0] + ' is refused');
    assert.strictEqual(res.json.code, 'unauthorized', entry[0] + ' is refused by code');
  }
  // Case in the scheme is the client's business, not a reason to fail.
  const lower = await call('GET', '/api/v1/me', { headers: { Authorization: 'bearer ' + session.accessToken } });
  assert.strictEqual(lower.status, 200, 'the scheme is matched case-insensitively');

  // ── Rotation over the wire ───────────────────────────────────────────────
  const refreshed = await call('POST', '/api/v1/auth/refresh', { body: { refreshToken: session.refreshToken } });
  assert.strictEqual(refreshed.status, 200, 'refresh succeeds');
  assert.notStrictEqual(refreshed.json.refreshToken, session.refreshToken, 'and rotates');
  const stillWorks = await call('GET', '/api/v1/me', { token: refreshed.json.accessToken });
  assert.strictEqual(stillWorks.status, 200, 'the new access token works');

  const badRefresh = await call('POST', '/api/v1/auth/refresh', { body: { refreshToken: 'nope' } });
  assert.strictEqual(badRefresh.status, 401, 'an unknown refresh token is 401');
  assert.strictEqual(badRefresh.json.code, 'refresh_invalid', 'with the one refresh failure code');
  const noBody = await call('POST', '/api/v1/auth/refresh', { body: {} });
  assert.strictEqual(noBody.json.code, 'refresh_invalid', 'a missing refresh token is the same failure');

  // ── Devices ──────────────────────────────────────────────────────────────
  const second = await call('POST', '/api/v1/auth/signin', { body: signinBody({ device: { name: 'Test iPad', platform: 'ios', installId: 'route-test-2' } }) });
  const devices = await call('GET', '/api/v1/auth/devices', { token: refreshed.json.accessToken });
  assert.strictEqual(devices.status, 200, 'the device list is readable');
  assert.strictEqual(devices.json.devices.length, 2, 'both devices are listed');
  assert.strictEqual(devices.json.devices.filter((d) => d.current).length, 1, 'one is marked current');
  assert.ok(!JSON.stringify(devices.json).includes('install'), 'the list carries no install identifier');

  const revoke = await call('DELETE', '/api/v1/auth/devices/' + second.json.deviceId, { token: refreshed.json.accessToken });
  assert.strictEqual(revoke.status, 200, 'a device can be revoked from another device');
  const revokedUse = await call('GET', '/api/v1/me', { token: second.json.accessToken });
  assert.strictEqual(revokedUse.status, 401, 'the revoked device stops working on its next request');

  const madeUp = await call('DELETE', '/api/v1/auth/devices/11111111-2222-4333-8444-555555555555', { token: refreshed.json.accessToken });
  assert.strictEqual(madeUp.status, 404, 'an unknown device id is a 404');
  assert.strictEqual(madeUp.json.code, 'device_not_found', 'with a code, not a stack trace');
  const notAUuid = await call('DELETE', '/api/v1/auth/devices/..%2F..%2Fetc%2Fpasswd', { token: refreshed.json.accessToken });
  assert.strictEqual(notAUuid.status, 404, 'a path-shaped device id is a 404, not an error');

  // ── Sign out ─────────────────────────────────────────────────────────────
  const out = await call('POST', '/api/v1/auth/signout', { token: refreshed.json.accessToken });
  assert.strictEqual(out.status, 200, 'sign-out answers 200');
  const afterOut = await call('GET', '/api/v1/me', { token: refreshed.json.accessToken });
  assert.strictEqual(afterOut.status, 401, 'and the token stops working');
  const outAgain = await call('POST', '/api/v1/auth/signout', { token: refreshed.json.accessToken });
  assert.strictEqual(outAgain.status, 200, 'sign-out is idempotent');
  const outAnonymous = await call('POST', '/api/v1/auth/signout', {});
  assert.strictEqual(outAnonymous.status, 200, 'sign-out with no credential is still 200');

  // Signing out with the refresh token alone, which is what a client holding an
  // expired access token has in its hand.
  const third = await call('POST', '/api/v1/auth/signin', { body: signinBody({ device: { name: 'Third', platform: 'android', installId: 'route-test-3' } }) });
  const outByRefresh = await call('POST', '/api/v1/auth/signout', { body: { refreshToken: third.json.refreshToken } });
  assert.strictEqual(outByRefresh.status, 200, 'sign-out accepts a refresh token');
  const thirdAfter = await call('GET', '/api/v1/me', { token: third.json.accessToken });
  assert.strictEqual(thirdAfter.status, 401, 'and ends that session');

  // ── The two surfaces do not honour each other ────────────────────────────
  // A cookie value is not a bearer token: /api/v1 looks in device_tokens, where
  // a web session has never been written.
  const cookieShaped = crypto.randomBytes(32).toString('base64url');
  const asBearer = await call('GET', '/api/v1/me', { token: cookieShaped });
  assert.strictEqual(asBearer.status, 401, 'a session-cookie value is not accepted as a bearer token');

  const fourth = await call('POST', '/api/v1/auth/signin', { body: signinBody({ device: { name: 'Fourth', platform: 'ios', installId: 'route-test-4' } }) });
  // And the other way: a device token set as the session cookie reaches a legacy
  // route as nobody. With no database the legacy routes can authenticate nobody
  // at all, so this is the weaker half of the pair; the strong form needs a
  // database and runs in scripts/device-auth-test.js against one.
  const legacy = await call('GET', '/api/household', { cookie: fourth.json.accessToken });
  assert.strictEqual(legacy.status, 401, 'a device token is not a session cookie');
  const legacyBearer = await call('GET', '/api/household', { token: fourth.json.accessToken });
  assert.strictEqual(legacyBearer.status, 401, 'and a legacy route does not read the Authorization header');
  const webSession = await call('GET', '/api/auth/session', { token: fourth.json.accessToken });
  assert.strictEqual(webSession.status, 200, 'the web session endpoint still answers');
  assert.strictEqual(webSession.json.user, null, 'and a bearer token makes nobody signed in there');

  // ── A client must never be handed HTML where it expected JSON ────────────
  const nonsense = await call('GET', '/api/v1/no-such-endpoint', { token: fourth.json.accessToken });
  assert.strictEqual(nonsense.status, 404, 'an unknown /api/v1 path is a 404');
  assert.ok(nonsense.contentType.includes('application/json'), 'answered as JSON, not the SPA shell');
  assert.strictEqual(nonsense.json.code, 'not_found', 'with a code a published client can switch on');
  const wrongMethod = await call('GET', '/api/v1/auth/signin', {});
  assert.strictEqual(wrongMethod.status, 404, 'the wrong method on a real endpoint is a coded 404');
  assert.strictEqual(wrongMethod.json.code, 'not_found', 'and still JSON');

  // ── Rate limiting, shared with the web ───────────────────────────────────
  // One budget per IP+email across both surfaces, not one each: ten attempts at
  // the web's sign-in and then the native one crosses the single limit of 20.
  const victim = { email: 'ratelimit@example.com', password: 'nope' };
  for (let i = 0; i < 10; i += 1) await call('POST', '/api/auth/signin', { body: victim });
  let limited = null;
  for (let i = 0; i < 11; i += 1) {
    const res = await call('POST', '/api/v1/auth/signin', { body: Object.assign({}, victim, { device: { name: 'x', platform: 'ios', installId: 'rl-' + i } }) });
    if (res.status === 429) { limited = res; break; }
  }
  assert.ok(limited, 'the shared budget runs out');
  assert.strictEqual(limited.json.code, 'rate_limited', 'and says so with a code');
  assert.ok(Number.isInteger(limited.json.retryAfter) && limited.json.retryAfter > 0, 'and says when to come back');

  // The bucket is per IP+email, so one account being attacked does not lock
  // everyone else out.
  const other = await call('POST', '/api/v1/auth/signin', { body: signinBody({ device: { name: 'Fifth', platform: 'ios', installId: 'route-test-5' } }) });
  assert.strictEqual(other.status, 200, 'another account is not caught in the same bucket');

  console.log('device-auth-routes-test: ok');
  process.exitCode = 0;
}

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    await run();
  } finally {
    app._test.useDeviceStore(null);
    server.close();
  }
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
