// The real credential store: iOS Keychain, Android Keystore-backed storage.
//
// This is the only file that imports the native module, and nothing that the
// offline tests exercise imports this file — the session machinery takes a
// CredentialStore and does not care which one it got.

import * as SecureStore from "expo-secure-store";
import { isStoredCredentials, memoryCredentialStore, type CredentialStore, type StoredCredentials } from "./credentialStore.ts";

const KEY = "recipebox.session.v1";

const OPTIONS: SecureStore.SecureStoreOptions = {
  // Available to a background refresh after the device has been unlocked once
  // since boot; never synced to iCloud; never restored onto another device.
  // A token is bound to the phone it was issued to, which is the point of
  // per-device revocation.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export function secureCredentialStore(): CredentialStore {
  return {
    persistent: true,
    async read() {
      const raw = await SecureStore.getItemAsync(KEY, OPTIONS);
      if (!raw) return null;
      let parsed: unknown = null;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      if (!isStoredCredentials(parsed)) {
        // Unreadable or from an older shape: drop it rather than guess. The
        // cost is one sign-in; the local library is untouched.
        await SecureStore.deleteItemAsync(KEY, OPTIONS);
        return null;
      }
      return parsed;
    },
    async write(credentials: StoredCredentials) {
      await SecureStore.setItemAsync(KEY, JSON.stringify(credentials), OPTIONS);
    },
    async clear() {
      await SecureStore.deleteItemAsync(KEY, OPTIONS);
    },
  };
}

/**
 * The store to use on this device. Where the native module is unavailable —
 * Expo Go, a build made before the module was added — credentials are held in
 * memory for the life of the process and `persistent` is false, so the app can
 * say "you will have to sign in again next launch" instead of silently
 * forgetting. It never falls back to unencrypted disk storage.
 */
export async function deviceCredentialStore(): Promise<CredentialStore> {
  try {
    if (await SecureStore.isAvailableAsync()) return secureCredentialStore();
  } catch {
    // fall through
  }
  return memoryCredentialStore();
}
