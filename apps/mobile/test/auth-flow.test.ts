// What happens around a session: opening the app, the bookkeeping either side
// of a sign-in, and what a failure is allowed to say out loud.
//
// The screens are not tested here — there is no renderer in this project — so
// everything a screen could get wrong is kept out of the screens: the copy is
// a pure function, and so is the decision about a credential found on a fresh
// install.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeAuthError, staleMessage } from "../src/auth/messages.ts";
import { AuthApiError, AuthNetworkError, type AuthUser } from "../src/auth/types.ts";
import { memoryDeviceState, shouldDropStoredCredential } from "../src/auth/deviceState.ts";
import { afterSignIn, afterSignOut, restoreSession, type SessionLike } from "../src/auth/restore.ts";
import { memoryCredentialStore, type StoredCredentials } from "../src/auth/credentialStore.ts";
import { applyLocalStore, BASE_LOCAL_STORE } from "../src/auth/localStore.ts";
import type { SessionState } from "../src/auth/session.ts";

const USER: AuthUser = { id: "user-alice", email: "alice@example.com", displayName: "Alice", role: "user", emailVerified: true, emailVerifiedAt: null };

function storedFor(id: string): StoredCredentials {
  return { refreshToken: "refresh-" + id, deviceId: "device-" + id, user: { id, email: id + "@example.com", displayName: id }, savedAt: new Date().toISOString() };
}

function fakeSession(result: SessionState): SessionLike & { restored: number } {
  let restored = 0;
  return {
    get state() { return result; },
    get restored() { return restored; },
    async restore() { restored += 1; return result; },
  };
}

// ---------------------------------------------------------------------------
// What a failure says
// ---------------------------------------------------------------------------

test("a failed sign-in never says whether the account exists", () => {
  const wrongPassword = describeAuthError(new AuthApiError(401, "invalid_credentials", "Email or password did not match."), "signin");
  assert.equal(wrongPassword.title, "Email or password did not match");
  const words = (wrongPassword.title + " " + (wrongPassword.detail ?? "")).toLowerCase();
  for (const giveaway of ["no account", "not found", "unknown", "does not exist", "no such"]) {
    assert.ok(!words.includes(giveaway), `the message must not contain "${giveaway}"`);
  }
});

test("being offline is never reported as a lost cookbook", () => {
  for (const context of ["signin", "session"] as const) {
    const message = describeAuthError(new AuthNetworkError("down"), context);
    assert.equal(message.title, "No connection");
    assert.ok(message.detail?.includes("still work"), "it says the recipes still work: " + message.detail);
    assert.equal(message.tone, "attention", "and is not dressed as a catastrophe");
  }
});

test("a server that is not RecipeBox is named as that, not as a wrong password", () => {
  const message = describeAuthError(new AuthApiError(200, "unsupported_response", "…"), "signin");
  assert.equal(message.title, "No sign-in server");
  assert.ok(message.detail?.includes("keeps working"), "and reassures about the device: " + message.detail);
});

test("rate limiting says how long to wait, in minutes a person would say", () => {
  const soon = describeAuthError(new AuthApiError(429, "rate_limited", "…", { retryAfter: 45 }), "signin");
  assert.ok(soon.detail?.includes("in a minute"), soon.detail);
  const later = describeAuthError(new AuthApiError(429, "rate_limited", "…", { retryAfter: 240 }), "signin");
  assert.ok(later.detail?.includes("4 minutes"), later.detail);
  const one = describeAuthError(new AuthApiError(429, "rate_limited", "…", { retryAfter: 61 }), "signin");
  assert.ok(one.detail?.includes("2 minutes") || one.detail?.includes("1 minute"), one.detail);
});

test("an expired session is an interruption, not a loss", () => {
  for (const code of ["refresh_invalid", "unauthorized", "token_expired"]) {
    const message = describeAuthError(new AuthApiError(401, code, "…"), "session");
    assert.equal(message.title, "Your session has ended");
    assert.ok(message.detail?.includes("Nothing on this device has changed"), message.detail);
  }
});

test("an unverified account is told what to do, and whether an email went", () => {
  const sent = describeAuthError(new AuthApiError(403, "email_verification_required", "…", { verificationEmailSent: true }), "signin");
  assert.ok(sent.detail?.includes("new confirmation link"), sent.detail);
  const notSent = describeAuthError(new AuthApiError(403, "email_verification_required", "…", { verificationEmailSent: false }), "signin");
  assert.ok(!notSent.detail?.includes("new confirmation link"), "it does not claim an email that was not sent: " + notSent.detail);
});

test("a signup rule is repeated in the server's own words", () => {
  const message = describeAuthError(new AuthApiError(400, "invalid_signup", "Use a password with at least 6 characters."), "signup");
  assert.equal(message.title, "Use a password with at least 6 characters.");
});

test("an unrecognised failure is generic rather than alarming", () => {
  assert.equal(describeAuthError(new Error("boom"), "signin").title, "Something went wrong");
  assert.equal(describeAuthError(new AuthApiError(500, "some_future_code", "…"), "signin").title, "Something went wrong");
});

test("a session held in memory says so, because it will not survive a relaunch", () => {
  assert.ok(staleMessage(true).detail?.includes("reconnect"), staleMessage(true).detail);
  assert.ok(staleMessage(false).detail?.includes("sign in again next launch"), staleMessage(false).detail);
});

// ---------------------------------------------------------------------------
// Opening the app
// ---------------------------------------------------------------------------

test("a credential found on a fresh install belonged to the last installation, and is dropped", async () => {
  // The iOS Keychain outlives the app. Someone who deletes RecipeBox to sign
  // out would otherwise find themselves still signed in, and a second-hand
  // phone would hand over the account with it.
  const credentials = memoryCredentialStore(storedFor("alice"));
  const session = fakeSession({ status: "active", user: USER, deviceId: "device-alice", persistent: true });
  const outcome = await restoreSession({ session, credentials, device: memoryDeviceState({ fresh: true }) });

  assert.equal(outcome.droppedForeignCredential, true);
  assert.equal(outcome.state.status, "signed-out");
  assert.equal(await credentials.read(), null, "the credential is gone");
  assert.equal(session.restored, 0, "and it was never presented to the server");
  assert.equal(outcome.store.name, BASE_LOCAL_STORE, "the local library is untouched by any of this");
});

test("the same credential on the installation that stored it is restored", async () => {
  const credentials = memoryCredentialStore(storedFor("alice"));
  const session = fakeSession({ status: "active", user: USER, deviceId: "device-alice", persistent: true });
  const outcome = await restoreSession({ session, credentials, device: memoryDeviceState({ fresh: false }) });

  assert.equal(outcome.droppedForeignCredential, false);
  assert.equal(outcome.state.status, "active");
  assert.equal(session.restored, 1);
  assert.ok(await credentials.read(), "and the credential is kept");
});

test("a fresh install with nothing stored is simply a fresh install", async () => {
  const credentials = memoryCredentialStore();
  const session = fakeSession({ status: "signed-out" });
  const outcome = await restoreSession({ session, credentials, device: memoryDeviceState({ fresh: true }) });
  assert.equal(outcome.droppedForeignCredential, false, "nothing was dropped, so nothing is announced");
  assert.equal(session.restored, 1);
});

test("the decision itself is one line, and only fires when both things are true", () => {
  assert.equal(shouldDropStoredCredential({ freshInstall: true, hasStoredCredential: true }), true);
  assert.equal(shouldDropStoredCredential({ freshInstall: true, hasStoredCredential: false }), false);
  assert.equal(shouldDropStoredCredential({ freshInstall: false, hasStoredCredential: true }), false);
});

test("restoring offline resolves the library for the person who is signed in", async () => {
  const device = memoryDeviceState({ fresh: false, claim: "user-bob", lastUser: "user-alice" });
  const session = fakeSession({ status: "stale", user: USER, deviceId: "d", persistent: true, retryInMs: 1000 });
  const outcome = await restoreSession({ session, credentials: memoryCredentialStore(storedFor("alice")), device });
  assert.equal(outcome.state.status, "stale");
  assert.notEqual(outcome.store.name, BASE_LOCAL_STORE, "Alice is a guest on Bob's phone, offline or not");
  assert.equal(outcome.store.isolated, true);
});

// ---------------------------------------------------------------------------
// Either side of a sign-in
// ---------------------------------------------------------------------------

test("the first account to sign in adopts the library already on the device", async () => {
  const device = memoryDeviceState({ fresh: false });
  const resolved = await afterSignIn(device, "user-alice");
  assert.equal(resolved.name, BASE_LOCAL_STORE);
  assert.equal(await device.getClaim(), "user-alice", "and the claim is remembered");
  assert.equal(await device.getLastUser(), "user-alice");
});

test("a second account is kept apart, and the first keeps its claim", async () => {
  const device = memoryDeviceState({ fresh: false, claim: "user-alice" });
  const resolved = await afterSignIn(device, "user-bob");
  assert.equal(resolved.isolated, true);
  assert.notEqual(resolved.name, BASE_LOCAL_STORE);
  assert.equal(await device.getClaim(), "user-alice", "Alice's claim is not taken from her");
});

test("a guest who signs out does not land in the owner's library", async () => {
  const device = memoryDeviceState({ fresh: false, claim: "user-alice", lastUser: "user-bob" });
  const afterOut = await afterSignOut(device);
  assert.equal(afterOut.isolated, true);
  assert.notEqual(afterOut.name, BASE_LOCAL_STORE);
  assert.equal(await device.getLastUser(), "user-bob", "signing out does not forget who it was");
});

test("the owner signing out is back in their own library", async () => {
  const device = memoryDeviceState({ fresh: false, claim: "user-alice", lastUser: "user-alice" });
  const afterOut = await afterSignOut(device);
  assert.equal(afterOut.name, BASE_LOCAL_STORE);
  assert.equal(afterOut.isolated, false);
});

test("an install id is minted once and then kept", async () => {
  const device = memoryDeviceState({ fresh: true });
  const first = await device.getInstallId();
  assert.ok(first.length >= 24, "it is long enough to be unguessable: " + first);
  assert.equal(await device.getInstallId(), first, "and stable for the life of the installation");
  assert.notEqual(await memoryDeviceState({ fresh: true }).getInstallId(), first, "a different installation is a different device");
});

test("nothing in the auth layer can reach a recipe", async () => {
  // The rule is "signing out never costs anyone their cookbook", and the way
  // it is kept is structural rather than careful: the auth modules hold no
  // reference to the recipe store, so there is no line anyone could write in
  // them that deletes a recipe. A test, because a future import would undo it
  // silently.
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../src/auth/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  assert.ok(files.length >= 8, "the auth folder was found: " + files.join(", "));

  for (const file of files) {
    const source = readFileSync(new URL(file, dir), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const specifier of imports) {
      assert.ok(
        !/\/data\//.test(specifier) && !specifier.endsWith("/db") && !specifier.endsWith("/db.ts"),
        `${file} imports ${specifier}: the auth layer must not be able to touch the recipe store`,
      );
    }
  }
});

test("a fresh install is fresh exactly once", async () => {
  const device = memoryDeviceState({ fresh: true });
  assert.equal(await device.isFreshInstall(), true);
  assert.equal(await device.isFreshInstall(), false, "the second launch is not a new install");
});

// ---------------------------------------------------------------------------
// The resolved library is the one that gets opened
// ---------------------------------------------------------------------------
//
// The gap these cover was a real one. Deciding which library an account may
// open was complete and tested; opening it was never wired up, so the data
// layer kept its one hardcoded file. A second account on a shared phone read
// the first account's recipes, and the Account screen displayed a notice
// saying their library was separate. Resolving and opening are tested together
// from here on, because apart they both passed.

/** Records what the data layer was asked to open. */
function recordingOpener() {
  const opened: string[] = [];
  return {
    opened,
    open: async (name: string) => { opened.push(name); },
  };
}

test("a second account on a shared phone opens its own library, not the first one's", async () => {
  const device = memoryDeviceState({ fresh: false, claim: "user-alice", lastUser: "user-alice" });
  const opener = recordingOpener();

  const bob = await applyLocalStore(await afterSignIn(device, "user-bob"), opener.open);

  assert.equal(bob.isolated, true, "the resolver says this is a separate library");
  assert.notEqual(bob.name, BASE_LOCAL_STORE, "and it is not the base one");
  assert.deepEqual(opener.opened, [bob.name], "and that is the file that was opened");
});

test("the first account keeps the library it already had", async () => {
  const device = memoryDeviceState({ fresh: false, claim: null, lastUser: null });
  const opener = recordingOpener();

  const alice = await applyLocalStore(await afterSignIn(device, "user-alice"), opener.open);

  assert.equal(alice.isolated, false);
  assert.deepEqual(opener.opened, [BASE_LOCAL_STORE], "the local-first library, as always");
});

test("switching back and forth opens each account's own library each time", async () => {
  const device = memoryDeviceState({ fresh: false, claim: "user-alice", lastUser: "user-alice" });
  const opener = recordingOpener();

  const bob = await applyLocalStore(await afterSignIn(device, "user-bob"), opener.open);
  const backToAlice = await applyLocalStore(await afterSignIn(device, "user-alice"), opener.open);
  const bobAgain = await applyLocalStore(await afterSignIn(device, "user-bob"), opener.open);

  assert.equal(backToAlice.name, BASE_LOCAL_STORE);
  assert.equal(bobAgain.name, bob.name, "a store is stable, so signing back in finds the same recipes");
  assert.deepEqual(opener.opened, [bob.name, BASE_LOCAL_STORE, bob.name]);
});

test("a guest who signs out stays in their own library rather than the owner's", async () => {
  // Signing out is not a request to hand the phone back to whoever owns the
  // base store. Nothing is deleted either way (ADR 0006).
  const device = memoryDeviceState({ fresh: false, claim: "user-alice", lastUser: "user-bob" });
  const opener = recordingOpener();

  const out = await applyLocalStore(await afterSignOut(device), opener.open);

  assert.equal(out.isolated, true);
  assert.notEqual(out.name, BASE_LOCAL_STORE);
  assert.deepEqual(opener.opened, [out.name]);
});

test("opening the app opens the library before anything could read a recipe", async () => {
  const device = memoryDeviceState({ fresh: false, claim: "user-alice", lastUser: "user-bob" });
  const session = fakeSession({ status: "active", user: USER, deviceId: "d", persistent: true });
  const opener = recordingOpener();

  const outcome = await restoreSession({ session, credentials: memoryCredentialStore(storedFor("bob")), device });
  const resolved = await applyLocalStore(outcome.store, opener.open);

  assert.deepEqual(opener.opened, [resolved.name]);
  assert.equal(opener.opened.length, 1, "and exactly once");
});
