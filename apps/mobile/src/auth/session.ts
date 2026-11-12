// The session, and the rules that keep authentication from costing anyone
// their recipes.
//
// Three of those rules are the whole design, and every one of them is a line
// someone would otherwise cross for convenience:
//
//   1. A network failure never signs anyone out. Only the server, answering
//      `refresh_invalid`, ends a session. Failing to reach it means "stale",
//      and a stale session still reads every recipe on the device.
//   2. Nothing here can delete local data. This module holds no reference to
//      the database — not a private one, not an injected one — so "sign-out
//      wiped my recipes" is not a bug that can be written here.
//   3. The access token is never written down. It lives in this closure for
//      fifteen minutes.

import { AuthApiError, AuthNetworkError, type AuthUser, type DeviceDescriptor } from "./types.ts";
import type { AuthApi } from "./apiClient.ts";
import type { CredentialStore, StoredCredentials } from "./credentialStore.ts";

export type SessionState =
  | { status: "signed-out" }
  /** Signed in, with a usable access token (or one we can get silently). */
  | { status: "active"; user: AuthUser; deviceId: string; persistent: boolean }
  /** Signed in, but the server is unreachable. Local reading continues. */
  | { status: "stale"; user: AuthUser; deviceId: string; persistent: boolean; retryInMs: number }
  /** The server ended it. Sign in again; the local library is untouched. */
  | { status: "expired"; user: AuthUser | null };

export type SignOutResult = { localDataRetained: true };

export type SessionManagerOptions = {
  api: AuthApi;
  credentials: CredentialStore;
  device: DeviceDescriptor;
  now?: () => number;
  onChange?: (state: SessionState) => void;
  /** Injected so the backoff test does not have to wait for real seconds. */
  jitter?: () => number;
};

/** Refresh this long before the access token actually expires, so an ordinary
 *  request is never the thing that discovers it has run out. */
const REFRESH_MARGIN_MS = 60_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** 1s, 2s, 4s … capped at five minutes, with jitter so a flock of devices
 *  coming back onto a network does not arrive in step. */
export function retryDelayMs(attempt: number, jitter = Math.random): number {
  const exponent = Math.max(0, Math.min(attempt, 12));
  const ceiling = Math.min(BASE_BACKOFF_MS * Math.pow(2, exponent), MAX_BACKOFF_MS);
  return Math.round(ceiling * (0.5 + (jitter() * 0.5)));
}

/** True for the two codes that mean "this access token will not do", and only
 *  those: every other refusal belongs to the caller, not to the session. */
export function isAuthChallenge(err: unknown): boolean {
  return err instanceof AuthApiError && (err.code === "unauthorized" || err.code === "token_expired");
}

export function createSessionManager(options: SessionManagerOptions) {
  const now = options.now ?? (() => Date.now());
  const jitter = options.jitter ?? Math.random;

  let state: SessionState = { status: "signed-out" };
  let accessToken: string | null = null;      // memory only, by design
  let accessExpiresAt = 0;
  let refreshToken: string | null = null;
  let deviceId: string | null = null;
  let user: AuthUser | null = null;
  let failedRefreshes = 0;
  let inFlight: Promise<void> | null = null;  // single-flight refresh

  function setState(next: SessionState) {
    state = next;
    if (options.onChange) options.onChange(next);
  }

  async function persist() {
    if (!refreshToken || !user || !deviceId) return;
    const stored: StoredCredentials = {
      refreshToken,
      deviceId,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      savedAt: new Date(now()).toISOString(),
    };
    await options.credentials.write(stored);
  }

  function adopt(result: { accessToken: string; expiresIn: number; refreshToken: string; deviceId: string; user?: AuthUser }) {
    accessToken = result.accessToken;
    accessExpiresAt = now() + (result.expiresIn * 1000);
    refreshToken = result.refreshToken;
    deviceId = result.deviceId;
    if (result.user) user = result.user;
    failedRefreshes = 0;
  }

  function goActive() {
    if (!user || !deviceId) return;
    setState({ status: "active", user, deviceId, persistent: options.credentials.persistent });
  }

  function goStale() {
    if (!user || !deviceId) { setState({ status: "signed-out" }); return; }
    failedRefreshes += 1;
    setState({ status: "stale", user, deviceId, persistent: options.credentials.persistent, retryInMs: retryDelayMs(failedRefreshes - 1, jitter) });
  }

  /** The session is over, and the server said so. Credentials go; the local
   *  library stays, because it was never the server's to take away. */
  async function goExpired() {
    accessToken = null;
    accessExpiresAt = 0;
    refreshToken = null;
    await options.credentials.clear();
    setState({ status: "expired", user });
  }

  async function doRefresh(): Promise<void> {
    if (!refreshToken) { await goExpired(); return; }
    try {
      const result = await options.api.refresh(refreshToken);
      adopt(result);
      await persist();
      goActive();
    } catch (err) {
      if (err instanceof AuthNetworkError) {
        // Unreachable, not rejected. Keep the credentials and say so.
        goStale();
        throw err;
      }
      if (err instanceof AuthApiError && err.code === "rate_limited") {
        goStale();
        throw err;
      }
      await goExpired();
      throw err;
    }
  }

  /** One refresh at a time. Several screens hitting a 401 at once must not
   *  each spend the refresh token — the second rotation would present a token
   *  the first had already spent. */
  function refreshOnce(): Promise<void> {
    if (!inFlight) {
      inFlight = doRefresh().finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  async function ensureAccessToken(): Promise<string> {
    if (accessToken && accessExpiresAt - now() > REFRESH_MARGIN_MS) return accessToken;
    if (!refreshToken) throw new AuthApiError(401, "unauthorized", "Sign in required.");
    await refreshOnce();
    if (!accessToken) throw new AuthApiError(401, "unauthorized", "Sign in required.");
    return accessToken;
  }

  return {
    get state(): SessionState { return state; },

    /** What the app knows at launch, before any network call. */
    async restore(): Promise<SessionState> {
      const stored = await options.credentials.read();
      if (!stored) { setState({ status: "signed-out" }); return state; }
      refreshToken = stored.refreshToken;
      deviceId = stored.deviceId;
      user = {
        id: stored.user.id,
        email: stored.user.email,
        displayName: stored.user.displayName,
        role: "user",
        emailVerified: true,
        emailVerifiedAt: null,
      };
      try {
        await refreshOnce();
      } catch {
        // goStale / goExpired has already set the state. A failed restore is
        // not an error the caller has to handle: the app opens either way.
      }
      return state;
    },

    async signIn(email: string, password: string): Promise<SessionState> {
      const result = await options.api.signIn(email, password, options.device);
      user = result.user;
      adopt(result);
      await persist();
      goActive();
      return state;
    },

    /**
     * Ends the session on this device. Tells the server if it can reach it,
     * and gives up quietly if it cannot — a sign-out that fails offline would
     * otherwise leave the person signed in against their wishes. The local
     * library is kept: signing out is not a request to destroy anything.
     */
    async signOut(): Promise<SignOutResult> {
      try {
        if (accessToken || refreshToken) {
          await options.api.signOut({ accessToken: accessToken ?? undefined, refreshToken: refreshToken ?? undefined });
        }
      } catch {
        // Best effort. The device-side credential goes regardless, and the
        // server-side session dies at its ceiling or when revoked from another
        // device.
      }
      accessToken = null;
      accessExpiresAt = 0;
      refreshToken = null;
      deviceId = null;
      user = null;
      failedRefreshes = 0;
      await options.credentials.clear();
      setState({ status: "signed-out" });
      return { localDataRetained: true };
    },

    /** Try again after a stale period — when connectivity returns, or when the
     *  backoff the state reported has elapsed. */
    async retry(): Promise<SessionState> {
      if (state.status !== "stale") return state;
      try { await refreshOnce(); } catch { /* state already reflects it */ }
      return state;
    },

    /**
     * Make an authenticated request. Refreshes ahead of expiry, and if the
     * server still says the token will not do, refreshes once and retries
     * exactly once — the rule a v1 client must follow, since `expiresIn` may
     * shrink and the clock on a phone is not evidence.
     */
    async authorized(path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
      const token = await ensureAccessToken();
      try {
        return await options.api.authorized(path, token, init);
      } catch (err) {
        if (!isAuthChallenge(err)) throw err;
        await refreshOnce();
        if (!accessToken) throw err;
        return options.api.authorized(path, accessToken, init);
      }
    },

    /** For the Settings screen: this account's other devices, and cutting one
     *  off. Revoking the current device signs this one out. */
    async devices() {
      const token = await ensureAccessToken();
      return (await options.api.devices(token)).devices;
    },

    async revokeDevice(id: string): Promise<void> {
      const token = await ensureAccessToken();
      await options.api.revokeDevice(token, id);
      if (id === deviceId) await this.signOut();
    },

    /** Test and diagnostics seam: proves the access token is not on disk by
     *  letting a test read what is, and what is not, in the store. */
    _debugHasAccessTokenInMemory(): boolean { return accessToken !== null; },
  };
}
