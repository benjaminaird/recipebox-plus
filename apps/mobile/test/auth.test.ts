// Native authentication: the API client's two kinds of failure, the session
// state machine, and the rules that keep a sign-out or a dropped connection
// from costing anyone their recipes.
//
// No network, no native modules, no React. The secure store is the one piece
// that cannot be exercised here — it is the Keychain — so it is kept in its own
// file behind the CredentialStore interface, and everything else is tested
// against an in-memory one of exactly that shape.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createAuthApi, type FetchLike } from "../src/auth/apiClient.ts";
import { createSessionManager, retryDelayMs, isAuthChallenge } from "../src/auth/session.ts";
import { memoryCredentialStore, isStoredCredentials } from "../src/auth/credentialStore.ts";
import { resolveLocalStore, localDataOnSignOut, BASE_LOCAL_STORE } from "../src/auth/localStore.ts";
import { AuthApiError, AuthNetworkError, type AuthUser, type DeviceDescriptor } from "../src/auth/types.ts";

const DEVICE: DeviceDescriptor = { name: "Test iPhone", platform: "ios", installId: "install-test" };
const USER: AuthUser = { id: "user-alice", email: "alice@example.com", displayName: "Alice", role: "user", emailVerified: true, emailVerifiedAt: "2026-01-01T00:00:00.000Z" };

type Reply = { status: number; body: unknown } | { throws: unknown };

/** A fetch whose answers the test writes, and which records what it was asked. */
function scriptedFetch(replies: Record<string, Reply[]>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = (init && init.method) || "GET";
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    calls.push({ url: path, method, headers: (init && init.headers) || {}, body: init && init.body ? JSON.parse(init.body) : null });
    const queue = replies[method + " " + path];
    if (!queue || queue.length === 0) throw new Error("no scripted reply for " + method + " " + path);
    const reply = queue.length === 1 ? queue[0] : queue.shift()!;
    if ("throws" in reply) throw reply.throws;
    return {
      status: reply.status,
      async json() { return reply.body; },
      async text() { return JSON.stringify(reply.body); },
    };
  };
  return { fetchImpl, calls };
}

function tokens(n: number, expiresIn = 900) {
  return { accessToken: "access-" + n, expiresIn, refreshToken: "refresh-" + n, refreshExpiresIn: 2592000, deviceId: "device-1", user: USER };
}

// ---------------------------------------------------------------------------
// The API client
// ---------------------------------------------------------------------------

test("a refusal from the server is an AuthApiError carrying its code", async () => {
  const { fetchImpl } = scriptedFetch({
    "POST /api/v1/auth/signin": [{ status: 401, body: { code: "invalid_credentials", message: "Email or password did not match." } }],
  });
  const api = createAuthApi({ baseUrl: "https://example.test", fetchImpl });
  await assert.rejects(
    () => api.signIn("a@b.c", "nope", DEVICE),
    (err: unknown) => err instanceof AuthApiError && err.code === "invalid_credentials" && err.status === 401,
  );
});

test("a request that never reached the server is an AuthNetworkError, not a refusal", async () => {
  const { fetchImpl } = scriptedFetch({ "POST /api/v1/auth/refresh": [{ throws: new TypeError("Network request failed") }] });
  const api = createAuthApi({ baseUrl: "https://example.test", fetchImpl });
  await assert.rejects(
    () => api.refresh("refresh-1"),
    (err: unknown) => err instanceof AuthNetworkError,
  );
});

test("an error code the client has never heard of reads as unknown rather than crashing", async () => {
  const { fetchImpl } = scriptedFetch({ "GET /api/v1/me": [{ status: 418, body: { code: "some_future_code", message: "…" } }] });
  const api = createAuthApi({ baseUrl: "https://example.test", fetchImpl });
  await assert.rejects(() => api.me("access-1"), (err: unknown) => err instanceof AuthApiError && err.code === "unknown");
});

test("an error body that is not JSON is still a refusal, not a network failure", async () => {
  const fetchImpl: FetchLike = async () => ({
    status: 502,
    async json() { throw new SyntaxError("Unexpected token <"); },
    async text() { return "<html>gateway</html>"; },
  });
  const api = createAuthApi({ baseUrl: "https://example.test", fetchImpl });
  await assert.rejects(() => api.me("access-1"), (err: unknown) => err instanceof AuthApiError && err.code === "unknown" && err.status === 502);
});

test("the access token travels as a bearer header and nowhere else", async () => {
  const { fetchImpl, calls } = scriptedFetch({ "GET /api/v1/me": [{ status: 200, body: { user: USER } }] });
  const api = createAuthApi({ baseUrl: "https://example.test/", fetchImpl });
  await api.me("access-secret");
  assert.equal(calls[0].headers.Authorization, "Bearer access-secret");
  assert.ok(!calls[0].url.includes("access-secret"), "never in the URL, where it would reach logs and proxies");
  assert.equal(calls[0].body, null, "and not in a body");
});

test("rate limiting arrives with the wait the server asked for", async () => {
  const { fetchImpl } = scriptedFetch({
    "POST /api/v1/auth/signin": [{ status: 429, body: { code: "rate_limited", message: "Too many attempts.", retryAfter: 240 } }],
  });
  const api = createAuthApi({ baseUrl: "https://example.test", fetchImpl });
  await assert.rejects(() => api.signIn("a@b.c", "x", DEVICE), (err: unknown) => err instanceof AuthApiError && err.retryAfter === 240);
});

test("an unverified account is told, and told whether the email went out", async () => {
  const { fetchImpl } = scriptedFetch({
    "POST /api/v1/auth/signin": [{ status: 403, body: { code: "email_verification_required", message: "Confirm your email.", verificationEmailSent: true } }],
  });
  const api = createAuthApi({ baseUrl: "https://example.test", fetchImpl });
  await assert.rejects(
    () => api.signIn("a@b.c", "x", DEVICE),
    (err: unknown) => err instanceof AuthApiError && err.code === "email_verification_required" && err.verificationEmailSent === true,
  );
});

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

function manager(replies: Record<string, Reply[]>, opts: { credentials?: ReturnType<typeof memoryCredentialStore>; now?: () => number } = {}) {
  const { fetchImpl, calls } = scriptedFetch(replies);
  const credentials = opts.credentials ?? memoryCredentialStore();
  const api = createAuthApi({ baseUrl: "https://example.test", fetchImpl });
  const session = createSessionManager({ api, credentials, device: DEVICE, now: opts.now, jitter: () => 0.5 });
  return { session, credentials, calls };
}

test("signing in keeps the refresh token in the credential store and the access token out of it", async () => {
  const { session, credentials } = manager({ "POST /api/v1/auth/signin": [{ status: 200, body: tokens(1) }] });
  const state = await session.signIn("alice@example.com", "pw");
  assert.equal(state.status, "active");

  const stored = await credentials.read();
  assert.ok(stored && isStoredCredentials(stored), "what was written is the shape the secure store expects");
  assert.equal(stored!.refreshToken, "refresh-1");
  assert.ok(!JSON.stringify(stored).includes("access-1"), "the access token is never written down");
  assert.equal(stored!.user.email, "alice@example.com", "enough of the account to name it offline");
  assert.ok(session._debugHasAccessTokenInMemory(), "and it is held in memory instead");
});

test("with nothing stored, the app opens signed out and asks nobody", async () => {
  const { session, calls } = manager({});
  assert.equal((await session.restore()).status, "signed-out");
  assert.equal(calls.length, 0, "a fresh install makes no network call at launch");
});

test("a stored session is restored by one refresh", async () => {
  const credentials = memoryCredentialStore({ refreshToken: "refresh-1", deviceId: "device-1", user: { id: USER.id, email: USER.email, displayName: USER.displayName }, savedAt: new Date().toISOString() });
  const { session, calls } = manager({ "POST /api/v1/auth/refresh": [{ status: 200, body: tokens(2) }] }, { credentials });
  const state = await session.restore();
  assert.equal(state.status, "active");
  assert.equal(calls.length, 1, "exactly one call, not a sign-in");
  assert.equal((await credentials.read())!.refreshToken, "refresh-2", "the rotated token replaces the old one");
});

test("no connection at launch leaves the session stale, signed in, and offline-readable", async () => {
  const credentials = memoryCredentialStore({ refreshToken: "refresh-1", deviceId: "device-1", user: { id: USER.id, email: USER.email, displayName: USER.displayName }, savedAt: new Date().toISOString() });
  const { session } = manager({ "POST /api/v1/auth/refresh": [{ throws: new TypeError("Network request failed") }] }, { credentials });
  const state = await session.restore();

  assert.equal(state.status, "stale", "unreachable is not the same as rejected");
  assert.equal(state.status === "stale" && state.user.email, "alice@example.com", "and the app can still say who is signed in");
  assert.ok(state.status === "stale" && state.retryInMs > 0, "with a time to try again");
  assert.ok(await credentials.read(), "the credential is kept — losing it would mean a sign-in to read your own recipes");
});

test("only the server can end a session, and it does not take the library with it", async () => {
  const credentials = memoryCredentialStore({ refreshToken: "refresh-1", deviceId: "device-1", user: { id: USER.id, email: USER.email, displayName: USER.displayName }, savedAt: new Date().toISOString() });
  const { session } = manager({ "POST /api/v1/auth/refresh": [{ status: 401, body: { code: "refresh_invalid", message: "Sign in again to continue." } }] }, { credentials });
  const state = await session.restore();

  assert.equal(state.status, "expired");
  assert.equal(state.status === "expired" && state.user?.email, "alice@example.com", "the person is still named, so the prompt can be specific");
  assert.equal(await credentials.read(), null, "a rejected refresh token is thrown away");
  assert.equal(localDataOnSignOut(), "keep", "and nothing in this module deletes a recipe");
});

test("being rate-limited is a wait, not an eviction", async () => {
  const credentials = memoryCredentialStore({ refreshToken: "refresh-1", deviceId: "device-1", user: { id: USER.id, email: USER.email, displayName: USER.displayName }, savedAt: new Date().toISOString() });
  const { session } = manager({ "POST /api/v1/auth/refresh": [{ status: 429, body: { code: "rate_limited", message: "Too many attempts.", retryAfter: 60 } }] }, { credentials });
  const state = await session.restore();
  assert.equal(state.status, "stale");
  assert.ok(await credentials.read(), "the credential survives a 429");
});

test("a stale session recovers when the network comes back", async () => {
  const credentials = memoryCredentialStore({ refreshToken: "refresh-1", deviceId: "device-1", user: { id: USER.id, email: USER.email, displayName: USER.displayName }, savedAt: new Date().toISOString() });
  const { session } = manager({
    "POST /api/v1/auth/refresh": [
      { throws: new TypeError("Network request failed") },
      { status: 200, body: tokens(2) },
    ],
  }, { credentials });
  assert.equal((await session.restore()).status, "stale");
  assert.equal((await session.retry()).status, "active", "and nobody had to type a password");
});

test("an ordinary request refreshes ahead of expiry rather than failing first", async () => {
  let clock = 1_000_000;
  const { session, calls } = manager({
    "POST /api/v1/auth/signin": [{ status: 200, body: tokens(1, 900) }],
    "POST /api/v1/auth/refresh": [{ status: 200, body: tokens(2, 900) }],
    "GET /api/v1/household": [{ status: 200, body: { household: null } }],
  }, { now: () => clock });

  await session.signIn("alice@example.com", "pw");
  clock += 880 * 1000; // inside the refresh margin, before the token is dead
  await session.authorized("/api/v1/household");

  const paths = calls.map((c) => c.method + " " + c.url);
  assert.deepEqual(paths, ["POST /api/v1/auth/signin", "POST /api/v1/auth/refresh", "GET /api/v1/household"]);
  assert.equal(calls[2].headers.Authorization, "Bearer access-2", "the request went out with the new token");
});

test("a 401 in flight is refreshed and retried exactly once", async () => {
  const { session, calls } = manager({
    "POST /api/v1/auth/signin": [{ status: 200, body: tokens(1) }],
    "POST /api/v1/auth/refresh": [{ status: 200, body: tokens(2) }],
    "GET /api/v1/household": [
      { status: 401, body: { code: "token_expired", message: "Access token expired." } },
      { status: 200, body: { household: null } },
    ],
  });
  await session.signIn("alice@example.com", "pw");
  const result = await session.authorized("/api/v1/household");
  assert.deepEqual(result, { household: null });
  assert.equal(calls.filter((c) => c.url === "/api/v1/auth/refresh").length, 1, "one refresh");
  assert.equal(calls.filter((c) => c.url === "/api/v1/household").length, 2, "one retry, not a loop");
});

test("a 401 that survives the retry is surfaced, not retried again", async () => {
  const { session, calls } = manager({
    "POST /api/v1/auth/signin": [{ status: 200, body: tokens(1) }],
    "POST /api/v1/auth/refresh": [{ status: 200, body: tokens(2) }],
    "GET /api/v1/household": [{ status: 401, body: { code: "unauthorized", message: "Sign in required." } }],
  });
  await session.signIn("alice@example.com", "pw");
  await assert.rejects(() => session.authorized("/api/v1/household"), (err: unknown) => err instanceof AuthApiError);
  assert.equal(calls.filter((c) => c.url === "/api/v1/household").length, 2, "tried twice and stopped");
});

test("several screens hitting a 401 at once spend the refresh token only once", async () => {
  // The failure this prevents: two rotations racing, the second presenting a
  // token the first already spent, which the server reads as a replay and
  // answers by revoking the whole device.
  let clock = 1_000_000;
  const { session, calls } = manager({
    "POST /api/v1/auth/signin": [{ status: 200, body: tokens(1, 900) }],
    "POST /api/v1/auth/refresh": [{ status: 200, body: tokens(2, 900) }],
    "GET /api/v1/household": [{ status: 200, body: { household: null } }],
    "GET /api/v1/me": [{ status: 200, body: { user: USER } }],
  }, { now: () => clock });

  await session.signIn("alice@example.com", "pw");
  clock += 880 * 1000;
  await Promise.all([session.authorized("/api/v1/household"), session.authorized("/api/v1/me")]);
  assert.equal(calls.filter((c) => c.url === "/api/v1/auth/refresh").length, 1, "one refresh for both callers");
});

test("signing out tells the server, forgets the credential, and keeps the recipes", async () => {
  const { session, credentials, calls } = manager({
    "POST /api/v1/auth/signin": [{ status: 200, body: tokens(1) }],
    "POST /api/v1/auth/signout": [{ status: 200, body: { ok: true } }],
  });
  await session.signIn("alice@example.com", "pw");
  const result = await session.signOut();

  assert.equal(result.localDataRetained, true);
  assert.equal(session.state.status, "signed-out");
  assert.equal(await credentials.read(), null);
  assert.ok(calls.some((c) => c.url === "/api/v1/auth/signout"), "the server was told, so the device row is revoked now");
});

test("signing out with no connection still signs this device out", async () => {
  const { session, credentials } = manager({
    "POST /api/v1/auth/signin": [{ status: 200, body: tokens(1) }],
    "POST /api/v1/auth/signout": [{ throws: new TypeError("Network request failed") }],
  });
  await session.signIn("alice@example.com", "pw");
  await session.signOut();
  assert.equal(session.state.status, "signed-out", "a person who asks to sign out is signed out");
  assert.equal(await credentials.read(), null);
});

test("backoff grows, is capped, and is jittered", () => {
  const half = (n: number) => retryDelayMs(n, () => 0);
  assert.equal(half(0), 500);
  assert.equal(half(1), 1000);
  assert.equal(half(2), 2000);
  assert.equal(half(20), 150_000, "capped at five minutes, halved by the lowest jitter");
  const full = retryDelayMs(3, () => 1);
  assert.ok(full > half(3) && full <= 8000, "jitter spreads a flock of devices rather than lining them up");
});

test("only an authentication challenge triggers a refresh", () => {
  assert.equal(isAuthChallenge(new AuthApiError(401, "token_expired", "")), true);
  assert.equal(isAuthChallenge(new AuthApiError(401, "unauthorized", "")), true);
  assert.equal(isAuthChallenge(new AuthApiError(403, "email_verification_required", "")), false);
  assert.equal(isAuthChallenge(new AuthApiError(404, "not_found", "")), false);
  assert.equal(isAuthChallenge(new AuthNetworkError("offline")), false, "being offline is not a reason to spend a refresh token");
});

// ---------------------------------------------------------------------------
// Two accounts, one phone
// ---------------------------------------------------------------------------

test("the first account to sign in adopts the library that is already on the device", () => {
  const resolved = resolveLocalStore({ claimedBy: null, signedInUserId: "user-alice" });
  assert.equal(resolved.name, BASE_LOCAL_STORE, "the recipes someone added before they had an account stay theirs");
  assert.equal(resolved.claimedBy, "user-alice");
  assert.equal(resolved.isolated, false);
});

test("a second account on the same phone gets its own store, and cannot see the first", () => {
  const second = resolveLocalStore({ claimedBy: "user-alice", signedInUserId: "user-bob" });
  assert.notEqual(second.name, BASE_LOCAL_STORE);
  assert.equal(second.isolated, true);
  assert.equal(second.claimedBy, "user-alice", "and Alice's claim is not taken from her");
  assert.ok(!second.name.includes("user-bob"), "the file name does not carry an account identifier");

  const third = resolveLocalStore({ claimedBy: "user-alice", signedInUserId: "user-carla" });
  assert.notEqual(third.name, second.name, "two guests are two stores");
  assert.equal(resolveLocalStore({ claimedBy: "user-alice", signedInUserId: "user-bob" }).name, second.name, "and a store is stable across launches");
});

test("signing back in as the owner returns to the same library", () => {
  const back = resolveLocalStore({ claimedBy: "user-alice", signedInUserId: "user-alice" });
  assert.equal(back.name, BASE_LOCAL_STORE);
  assert.equal(back.isolated, false);
});

test("signing out leaves the library where it was", () => {
  const out = resolveLocalStore({ claimedBy: "user-alice", signedInUserId: null });
  assert.equal(out.name, BASE_LOCAL_STORE);
  assert.equal(out.claimedBy, "user-alice", "the claim survives a sign-out, so signing back in is not a migration");
  assert.equal(localDataOnSignOut(), "keep");
});
