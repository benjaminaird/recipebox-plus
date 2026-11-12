// Where the refresh token lives.
//
// The interface is deliberately tiny and deliberately async: the real
// implementation is the iOS Keychain and Android's Keystore-backed storage
// (see secureCredentialStore.ts), and both are async. Nothing else about the
// session machinery should know which one it has.
//
// The access token is NOT here. It lives fifteen minutes and stays in memory;
// writing it down would add exposure and buy nothing.

export type StoredCredentials = {
  refreshToken: string;
  deviceId: string;
  /**
   * Enough of the account to say who is signed in while the device is offline
   * and the server cannot be asked. Nothing secret: the email address is what
   * the person typed to sign in.
   */
  user: { id: string; email: string; displayName: string };
  /** ISO timestamp, for telling a stale session from a fresh install. */
  savedAt: string;
};

export type CredentialStore = {
  read(): Promise<StoredCredentials | null>;
  write(credentials: StoredCredentials): Promise<void>;
  clear(): Promise<void>;
  /**
   * False when the credential is held in memory only — a simulator without the
   * native module, or a test. The app must be able to say so rather than imply
   * a hardware-backed store it does not have.
   */
  readonly persistent: boolean;
};

export function memoryCredentialStore(initial?: StoredCredentials | null): CredentialStore {
  let held: StoredCredentials | null = initial ?? null;
  return {
    persistent: false,
    async read() { return held; },
    async write(credentials) { held = { ...credentials }; },
    async clear() { held = null; },
  };
}

export function isStoredCredentials(value: unknown): value is StoredCredentials {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const user = v.user as Record<string, unknown> | undefined;
  return typeof v.refreshToken === "string" && v.refreshToken.length > 0
    && typeof v.deviceId === "string"
    && typeof v.savedAt === "string"
    && !!user && typeof user === "object"
    && typeof user.id === "string" && user.id.length > 0
    && typeof user.email === "string";
}
