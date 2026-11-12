// The small facts about this installation that outlive a session but must not
// outlive the app: whether this is a fresh install, which account owns the
// local library, and who was signed in last.
//
// They live in their own SQLite file in the app's sandbox, which is removed
// when the app is deleted. That is the point — the iOS Keychain is not.
//
// The Keychain outlives the app that wrote to it: delete RecipeBox, reinstall
// it, and a refresh token from the old install is still there. For a password
// manager that is a feature. For a cookbook it is wrong twice over — someone
// who deletes the app to sign out stays signed in, and a device that changes
// hands hands the account over with it. So a credential is only honoured when
// the marker that was written beside it is still here.
//
// Android removes app data with the app, but auto-backup can restore it onto a
// new device, where the same reasoning applies.

/** The decision, with no storage in it, so it can be tested on its own. */
export function shouldDropStoredCredential(input: { freshInstall: boolean; hasStoredCredential: boolean }): boolean {
  return input.freshInstall && input.hasStoredCredential;
}

export type DeviceState = {
  /** True the first time this installation asks, false ever after. */
  isFreshInstall(): Promise<boolean>;
  /** The account that owns the base local library, if one has claimed it. */
  getClaim(): Promise<string | null>;
  setClaim(userId: string): Promise<void>;
  /** Who was signed in last, so signing out does not hand a guest the owner's library. */
  getLastUser(): Promise<string | null>;
  setLastUser(userId: string | null): Promise<void>;
  /**
   * A stable identifier for this installation, minted on first use. It is what
   * lets the server recognise the same phone across sign-ins instead of filling
   * the device list with duplicates — and because it lives beside the install
   * marker, a reinstall is a new device, which is the right answer.
   */
  getInstallId(): Promise<string>;
};

export function randomInstallId(): string {
  // A plain random id. It identifies an installation to the account that
  // created it and nothing else: no device identifier, nothing that outlives
  // the app, nothing shared between accounts.
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(16));
  if (bytes) return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return Date.now().toString(16) + Math.random().toString(16).slice(2, 14);
}

/** For tests, and for a device where the file cannot be opened. */
export function memoryDeviceState(initial?: { fresh?: boolean; claim?: string | null; lastUser?: string | null; installId?: string }): DeviceState {
  let fresh = initial?.fresh ?? true;
  let claim = initial?.claim ?? null;
  let lastUser = initial?.lastUser ?? null;
  let installId = initial?.installId ?? null;
  return {
    async getInstallId() {
      if (!installId) installId = randomInstallId();
      return installId;
    },
    async isFreshInstall() {
      const answer = fresh;
      fresh = false;
      return answer;
    },
    async getClaim() { return claim; },
    async setClaim(userId: string) { claim = userId; },
    async getLastUser() { return lastUser; },
    async setLastUser(userId: string | null) { lastUser = userId; },
  };
}
