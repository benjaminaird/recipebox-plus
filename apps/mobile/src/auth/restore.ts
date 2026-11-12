// What happens around a session, as opposed to inside it: the checks on the
// way in, and the bookkeeping on the way out.
//
// It lives apart from AuthProvider because this is the part worth testing, and
// a React provider is the part that is awkward to test. The provider wires
// these together and holds no rules of its own.

import type { CredentialStore } from "./credentialStore.ts";
import type { DeviceState } from "./deviceState.ts";
import { shouldDropStoredCredential } from "./deviceState.ts";
import { resolveLocalStore, type LocalStoreResolution } from "./localStore.ts";
import type { SessionState } from "./session.ts";

export type SessionLike = {
  restore(): Promise<SessionState>;
  readonly state: SessionState;
};

export type RestoreDeps = {
  session: SessionLike;
  credentials: CredentialStore;
  device: DeviceState;
};

export type RestoreOutcome = {
  state: SessionState;
  /** True when a credential from a previous installation was found and dropped. */
  droppedForeignCredential: boolean;
  store: LocalStoreResolution;
};

/**
 * Open the app.
 *
 * The first question is not "is there a credential" but "is this the same
 * installation that stored it". The iOS Keychain survives the app being
 * deleted, so a credential found on a fresh install belonged to whoever had
 * the phone before — possibly the same person, possibly not. It is dropped,
 * which costs a sign-in and nothing else: the local recipes are untouched,
 * because they live in the app's own storage and went with the old install
 * anyway.
 */
export async function restoreSession(deps: RestoreDeps): Promise<RestoreOutcome> {
  const fresh = await deps.device.isFreshInstall();
  const stored = await deps.credentials.read();

  if (shouldDropStoredCredential({ freshInstall: fresh, hasStoredCredential: !!stored })) {
    await deps.credentials.clear();
    const store = await resolveStore(deps.device, null);
    return { state: { status: "signed-out" }, droppedForeignCredential: true, store };
  }

  const state = await deps.session.restore();
  const signedIn = state.status === "active" || state.status === "stale" ? state.user.id : null;
  const store = await resolveStore(deps.device, signedIn);
  return { state, droppedForeignCredential: false, store };
}

/** Remember who signed in, and let the first account adopt the local library. */
export async function afterSignIn(device: DeviceState, userId: string): Promise<LocalStoreResolution> {
  await device.setLastUser(userId);
  const claimedBy = await device.getClaim();
  const resolved = resolveLocalStore({ claimedBy, signedInUserId: userId });
  if (!claimedBy && resolved.claimedBy) await device.setClaim(resolved.claimedBy);
  return resolved;
}

/**
 * Signing out keeps the last account, so a guest who signs out on a borrowed
 * phone stays in their own local store rather than landing in the owner's
 * library. Nothing is deleted: signing out is not a request to destroy
 * anyone's recipes (ADR 0006).
 */
export async function afterSignOut(device: DeviceState): Promise<LocalStoreResolution> {
  return resolveStore(device, null);
}

async function resolveStore(device: DeviceState, signedInUserId: string | null): Promise<LocalStoreResolution> {
  const [claimedBy, lastUserId] = await Promise.all([device.getClaim(), device.getLastUser()]);
  return resolveLocalStore({ claimedBy, signedInUserId, lastUserId });
}
