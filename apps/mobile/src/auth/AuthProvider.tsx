// The session, as the rest of the app sees it.
//
// Thin on purpose: every rule lives in session.ts (what a failure means) or
// restore.ts (what happens around a session). This wires them to React and
// holds nothing of its own, so there is no second place where "signed in"
// could come to mean something slightly different.
//
// RecipeBox works signed out. This provider never blocks a render, never gates
// the navigator, and never has an opinion about the local library — the app
// opens to the same recipes whether or not any of this succeeds.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { createAuthApi, type AuthApi } from "./apiClient.ts";
import { createSessionManager, type SessionState } from "./session.ts";
import { deviceCredentialStore } from "./secureCredentialStore.ts";
import { sqliteDeviceState as createDeviceState } from "./sqliteDeviceState.ts";
import { afterSignIn, afterSignOut, restoreSession } from "./restore.ts";
import { apiBaseUrl, deviceName } from "./config.ts";
import { AuthApiError, type DeviceSummary } from "./types.ts";
import type { LocalStoreResolution } from "./localStore.ts";
import type { CredentialStore } from "./credentialStore.ts";

type Manager = ReturnType<typeof createSessionManager>;

export type AuthValue = {
  /** The session. "signed-out" until the restore finishes. */
  state: SessionState;
  /** The restore has run. Until then the app shows nothing about accounts. */
  ready: boolean;
  /** This build knows where its server is. When false, every action refuses. */
  configured: boolean;
  /** False when the refresh token is held in memory only — no Keychain here. */
  persistentCredentials: boolean;
  /** Which local library is open, and whether it is this account's own. */
  localStore: LocalStoreResolution | null;
  /** A credential from a previous installation was found and dropped. */
  droppedForeignCredential: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<{ verificationEmailSent: boolean }>;
  signOut(): Promise<void>;
  resendVerification(email: string, password: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  retry(): Promise<void>;
  devices(): Promise<DeviceSummary[]>;
  revokeDevice(id: string): Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

function notConfigured(): never {
  throw new AuthApiError(0, "unsupported_response", "This copy of RecipeBox has no server to sign in to.");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "signed-out" });
  const [ready, setReady] = useState(false);
  const [localStore, setLocalStore] = useState<LocalStoreResolution | null>(null);
  const [droppedForeignCredential, setDropped] = useState(false);
  const [persistent, setPersistent] = useState(true);

  const managerRef = useRef<Manager | null>(null);
  const apiRef = useRef<AuthApi | null>(null);
  const credentialsRef = useRef<CredentialStore | null>(null);
  const deviceRef = useRef(createDeviceState());
  const baseUrl = apiBaseUrl();

  useEffect(() => {
    let live = true;
    (async () => {
      if (!baseUrl) { if (live) setReady(true); return; }
      try {
        const credentials = await deviceCredentialStore();
        const installId = await deviceRef.current.getInstallId();
        credentialsRef.current = credentials;
        if (live) setPersistent(credentials.persistent);

        const api = createAuthApi({
          baseUrl,
          fetchImpl: (url, init) => fetch(url, init as RequestInit),
        });
        apiRef.current = api;

        const manager = createSessionManager({
          api,
          credentials,
          device: {
            name: deviceName(),
            platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "unknown",
            installId,
          },
          onChange: (next) => { if (live) setState(next); },
        });
        managerRef.current = manager;

        const outcome = await restoreSession({ session: manager, credentials, device: deviceRef.current });
        if (!live) return;
        setState(outcome.state);
        setLocalStore(outcome.store);
        setDropped(outcome.droppedForeignCredential);
      } catch {
        // Opening the app must not depend on any of this working.
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => { live = false; };
  }, [baseUrl]);

  const signIn = useCallback(async (email: string, password: string) => {
    const manager = managerRef.current;
    if (!manager) notConfigured();
    const next = await manager.signIn(email, password);
    if (next.status === "active") setLocalStore(await afterSignIn(deviceRef.current, next.user.id));
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const api = apiRef.current;
    if (!api) notConfigured();
    const result = await api.signUp(email, password, displayName);
    return { verificationEmailSent: result.verificationEmailSent };
  }, []);

  const signOut = useCallback(async () => {
    const manager = managerRef.current;
    if (!manager) return;
    await manager.signOut();
    setLocalStore(await afterSignOut(deviceRef.current));
  }, []);

  const resendVerification = useCallback(async (email: string, password: string) => {
    const api = apiRef.current;
    if (!api) notConfigured();
    await api.resendVerification(email, password);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const api = apiRef.current;
    if (!api) notConfigured();
    await api.requestPasswordReset(email);
  }, []);

  const retry = useCallback(async () => {
    const manager = managerRef.current;
    if (manager) await manager.retry();
  }, []);

  const devices = useCallback(async () => {
    const manager = managerRef.current;
    if (!manager) notConfigured();
    return manager.devices();
  }, []);

  const revokeDevice = useCallback(async (id: string) => {
    const manager = managerRef.current;
    if (!manager) notConfigured();
    await manager.revokeDevice(id);
    if (managerRef.current?.state.status === "signed-out") setLocalStore(await afterSignOut(deviceRef.current));
  }, []);

  const value = useMemo<AuthValue>(() => ({
    state,
    ready,
    configured: !!baseUrl,
    persistentCredentials: persistent,
    localStore,
    droppedForeignCredential,
    signIn, signUp, signOut, resendVerification, requestPasswordReset, retry, devices, revokeDevice,
  }), [state, ready, baseUrl, persistent, localStore, droppedForeignCredential, signIn, signUp, signOut, resendVerification, requestPasswordReset, retry, devices, revokeDevice]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
