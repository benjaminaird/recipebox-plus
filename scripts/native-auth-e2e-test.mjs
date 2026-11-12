// The native client against the real server.
//
// The other two suites each prove one side: scripts/device-auth-*.js prove the
// server's rules, apps/mobile/test/auth.test.ts proves the client's against a
// scripted fetch. Neither would notice if the two disagreed. This one imports
// the app's own session manager — the very TypeScript the phone runs — points
// it at an Express server listening on an ephemeral port, and makes it sign in,
// rotate, lose its session, and go offline for real.
//
// Still offline in the sense that matters for CI: no external network, no
// database, no device. Run with `node --experimental-strip-types`.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const app = require('../server.js');
const deviceAuth = require('../lib/device-auth.js');

const { createAuthApi } = await import('../apps/mobile/src/auth/apiClient.ts');
const { createSessionManager } = await import('../apps/mobile/src/auth/session.ts');
const { memoryCredentialStore } = await import('../apps/mobile/src/auth/credentialStore.ts');

const PASSWORD = 'correct horse battery';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(String(password), salt, 32).toString('hex');
}

const store = deviceAuth.createMemoryStore([
  { user_id: 'user-alice', email: 'alice@example.com', display_name: 'Alice', role: 'user', password_hash: hashPassword(PASSWORD), email_verified: true, email_verified_at: new Date('2026-01-01T00:00:00Z') },
]);
app._test.useDeviceStore(store);

const DEVICE = { name: 'E2E iPhone', platform: 'ios', installId: 'e2e-phone' };

let clock = Date.now();
const now = () => clock;

// A suite that stops halfway must not pass. An await on a promise that never
// settles empties the event loop, and node then exits 0 with most of the file
// unrun -- so the exit code starts as a failure and is cleared only where the
// suite announces that it finished.
process.exitCode = 1;

function makeSession(baseUrl, credentials, device = DEVICE) {
  const api = createAuthApi({ baseUrl, fetchImpl: (url, init) => fetch(url, init), timeoutMs: 5000 });
  return createSessionManager({ api, credentials, device, now, jitter: () => 0.5 });
}

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = 'http://127.0.0.1:' + server.address().port;

  try {
    const credentials = memoryCredentialStore();
    const session = makeSession(baseUrl, credentials);

    // ── Sign in ──────────────────────────────────────────────────────────
    let state = await session.signIn('alice@example.com', PASSWORD);
    assert.strictEqual(state.status, 'active', 'the client signs in against the real server');
    assert.strictEqual(state.user.email, 'alice@example.com', 'as the web account');
    const stored = await credentials.read();
    assert.ok(stored.refreshToken, 'the refresh token is kept');

    const me = await session.authorized('/api/v1/me');
    assert.strictEqual(me.user.id, 'user-alice', 'an authenticated call works end to end');

    // ── Rotation, without anyone noticing ────────────────────────────────
    const before = (await credentials.read()).refreshToken;
    clock += 890 * 1000; // inside the refresh margin
    const stillFine = await session.authorized('/api/v1/me');
    assert.strictEqual(stillFine.user.id, 'user-alice', 'the call succeeds across a silent refresh');
    const after = (await credentials.read()).refreshToken;
    assert.notStrictEqual(after, before, 'and the refresh token rotated on the way');
    assert.strictEqual(session.state.status, 'active', 'the session never left active');

    // ── A second device, and revoking the first from it ──────────────────
    const otherCredentials = memoryCredentialStore();
    const other = makeSession(baseUrl, otherCredentials, { name: 'E2E iPad', platform: 'ios', installId: 'e2e-tablet' });
    const otherApi = createAuthApi({ baseUrl, fetchImpl: (url, init) => fetch(url, init) });
    await other.signIn('alice@example.com', PASSWORD);
    const devices = await other.devices();
    assert.strictEqual(devices.length, 2, 'both devices are listed');
    const first = devices.find((d) => !d.current);
    assert.ok(first, 'the other device is identified');

    await other.revokeDevice(first.id);

    // The revoked device finds out on its next request: a 401, one refresh
    // attempt, and the server's refusal ends the session. This is the path a
    // "sign out my lost phone" actually takes.
    clock += 1000;
    await assert.rejects(() => session.authorized('/api/v1/me'), (err) => err.name === 'AuthApiError');
    assert.strictEqual(session.state.status, 'expired', 'the revoked device is signed out by the server');
    assert.strictEqual(await credentials.read(), null, 'and throws its credential away');

    // ── Offline is not a sign-out ────────────────────────────────────────
    const offlineCredentials = memoryCredentialStore();
    const online = makeSession(baseUrl, offlineCredentials, { name: 'E2E offline phone', platform: 'ios', installId: 'e2e-offline' });
    await online.signIn('alice@example.com', PASSWORD);
    const kept = await offlineCredentials.read();

    // Same credential, a server that cannot be reached at all.
    const offline = makeSession('http://127.0.0.1:1', offlineCredentials, { name: 'E2E offline phone', platform: 'ios', installId: 'e2e-offline' });
    const offlineState = await offline.restore();
    assert.strictEqual(offlineState.status, 'stale', 'an unreachable server leaves the session stale');
    assert.strictEqual((await offlineCredentials.read()).refreshToken, kept.refreshToken, 'and the credential is untouched');

    // Back on the network, with no password typed.
    const recovered = makeSession(baseUrl, offlineCredentials, { name: 'E2E offline phone', platform: 'ios', installId: 'e2e-offline' });
    assert.strictEqual((await recovered.restore()).status, 'active', 'and it recovers when the server returns');

    // ── Sign out ─────────────────────────────────────────────────────────
    const recoveredDeviceId = recovered.state.deviceId;
    const result = await recovered.signOut();
    assert.strictEqual(result.localDataRetained, true, 'signing out keeps the local library');
    assert.strictEqual(await offlineCredentials.read(), null, 'and forgets the credential');
    const afterOut = await otherApi.signIn('alice@example.com', PASSWORD, { ...DEVICE, installId: 'e2e-check' });
    const list = await otherApi.devices(afterOut.accessToken);
    assert.ok(!list.devices.some((d) => d.id === recoveredDeviceId), 'the signed-out device is gone from the account');

    process.exitCode = 0;
  console.log('native-auth-e2e-test: ok');
  } finally {
    app._test.useDeviceStore(null);
    server.close();
  }
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
