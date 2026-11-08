// Device-local appearance preference (ADR 0019): stored in the app's SQLite
// database through expo-sqlite's key-value store, so it lives with the rest of
// local-first data (ADR 0004). It is read synchronously before the first render,
// so the app never flashes the wrong appearance. It is not synced: a phone and a
// tablet may reasonably differ, and it must work before sign-in.
import Storage from "expo-sqlite/kv-store";
import { APPEARANCE_STORAGE_KEY, parsePreference, type AppearancePreference } from "./appearance";

export function loadAppearancePreference(): AppearancePreference {
  try {
    return parsePreference(Storage.getItemSync(APPEARANCE_STORAGE_KEY));
  } catch {
    return parsePreference(null);
  }
}

export function saveAppearancePreference(preference: AppearancePreference): void {
  try {
    Storage.setItemSync(APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // A failed write leaves the current session's choice in effect; it is
    // re-applied from memory and retried on the next change.
  }
}
